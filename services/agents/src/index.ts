import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  ensureCorrelationId,
  getPool,
  withIdempotency,
  recordOutbox,
  dispatchOutbox,
} from '@platform/shared';
import { buildEvent, persistEvent, publishEvent } from '@platform/events';

const pool = getPool('agents');

const app = Fastify({
  logger: true,
});

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, {
  openapi: {
    info: {
      title: 'Agents Service',
      version: '0.1.0',
    },
  },
});

app.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false,
  },
});

// --- Constants ---

const MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB hard cap for event payloads

const ACTION_TYPES = ['communicate', 'associate', 'create', 'exchange', 'conflict', 'withdraw'] as const;
type ActionType = (typeof ACTION_TYPES)[number];

// --- Payload helpers ---

/**
 * Truncate payload to MAX_PAYLOAD_BYTES to prevent self-DDoS via large artifacts.
 * Returns truncated JSON or null if payload is null/undefined.
 */
const truncatePayload = (payload: unknown): string | null => {
  if (payload === null || payload === undefined) return null;
  const json = JSON.stringify(payload);
  if (json.length <= MAX_PAYLOAD_BYTES) return json;
  // Truncate and mark as truncated
  const truncated = json.slice(0, MAX_PAYLOAD_BYTES - 50);
  return truncated + '...[TRUNCATED]"}';
};

// --- Event helpers ---

const appendEvent = async (
  eventType: string,
  payload: Record<string, unknown>,
  actorId?: string,
  correlationId?: string,
  idempotencyKey?: string,
) => {
  // Truncate payload before emitting
  const safePayload = { ...payload };
  if (safePayload.payload) {
    const truncated = truncatePayload(safePayload.payload);
    safePayload.payload = truncated ? JSON.parse(truncated) : null;
  }

  const evt = buildEvent(eventType, safePayload, {
    actorId: actorId ?? 'system',
    correlationId,
  });
  await persistEvent(pool, evt, { idempotencyKey, context: safePayload });
  const topic = 'events.agents.v1';
  try {
    await publishEvent(topic, evt);
  } catch (_err: unknown) {
    await recordOutbox(pool, topic, evt.event_id, evt);
  }
  return evt;
};

// --- Capacity reconciliation ---

interface CapacityRow {
  agent_id: string;
  balance: number;
  max_balance: number;
  regen_per_hour: number;
  last_reconciled_at: Date;
  policy: Record<string, unknown>;
}

const reconcileCapacity = (cap: CapacityRow): { newBalance: number; reconciledAt: Date } => {
  const now = new Date();
  const lastReconciled = new Date(cap.last_reconciled_at);
  const hoursPassed = (now.getTime() - lastReconciled.getTime()) / (1000 * 60 * 60);
  const regen = Math.floor(hoursPassed * cap.regen_per_hour);
  const newBalance = Math.min(cap.balance + regen, cap.max_balance);
  return { newBalance, reconciledAt: now };
};

// --- Health endpoints ---

app.get('/healthz', async () => ({ ok: true }));

app.get('/readyz', async () => {
  const checks: Record<string, boolean> = {};

  // 1. DB ping
  try {
    await pool.query('select 1');
    checks.db = true;
  } catch {
    checks.db = false;
  }

  // 2. Outbox/events table writable
  try {
    // Test write to outbox (will rollback)
    await pool.query('begin');
    await pool.query(
      `insert into outbox (event_id, topic, payload_json) values (gen_random_uuid(), '_readyz_probe', '{}')`,
    );
    await pool.query('rollback');
    checks.outbox_writable = true;
  } catch {
    checks.outbox_writable = false;
    try {
      await pool.query('rollback');
    } catch {
      // ignore rollback errors
    }
  }

  // 3. Kafka producer health (optional - best effort)
  try {
    // We don't have a direct health check for Kafka, so we mark as true if the above pass
    // In production, this could be enhanced with actual producer.isConnected() check
    checks.event_publisher = checks.db && checks.outbox_writable;
  } catch {
    checks.event_publisher = false;
  }

  const ready = checks.db && checks.outbox_writable;
  return { ready, checks };
});

// --- Agent CRUD ---

interface CreateAgentBody {
  handle?: string;
  deployment_target?: string;
  capacity?: {
    initial_balance?: number;
    max_balance?: number;
    regen_per_hour?: number;
  };
  config?: {
    bias?: Record<string, unknown>;
    throttle?: Record<string, unknown>;
    cognition?: Record<string, unknown>;
  };
}

app.post('/agents', async (request, reply) => {
  const body = request.body as CreateAgentBody;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  const result = await withIdempotency(pool, idempotencyKey, async () => {
    const agentRes = await pool.query(
      `insert into agents (handle, deployment_target)
       values ($1, $2)
       returning id, handle, status, deployment_target, created_at, updated_at`,
      [body.handle ?? null, body.deployment_target ?? null],
    );
    const agent = agentRes.rows[0];

    // Initialize capacity
    const initialBalance = body.capacity?.initial_balance ?? 100;
    const maxBalance = body.capacity?.max_balance ?? 100;
    const regenPerHour = body.capacity?.regen_per_hour ?? 10;
    await pool.query(
      `insert into agent_capacity (agent_id, balance, max_balance, regen_per_hour)
       values ($1, $2, $3, $4)`,
      [agent.id, initialBalance, maxBalance, regenPerHour],
    );

    // Initialize config
    const bias = body.config?.bias ?? {};
    const throttle = body.config?.throttle ?? {};
    const cognition = body.config?.cognition ?? {};
    await pool.query(
      `insert into agent_config (agent_id, bias, throttle, cognition) values ($1, $2, $3, $4)`,
      [agent.id, JSON.stringify(bias), JSON.stringify(throttle), JSON.stringify(cognition)],
    );

    const evt = await appendEvent(
      'agent.created',
      { agent_id: agent.id, handle: agent.handle, deployment_target: agent.deployment_target },
      agent.id,
      correlationId,
      idempotencyKey,
    );

    return { agent, event: evt };
  });

  reply.status(201);
  return result;
});

app.get('/agents/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const res = await pool.query(
    `select a.id, a.handle, a.status, a.deployment_target, a.created_at, a.updated_at,
            c.balance, c.max_balance, c.regen_per_hour, c.last_reconciled_at
     from agents a
     left join agent_capacity c on c.agent_id = a.id
     where a.id = $1`,
    [id],
  );
  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }
  const row = res.rows[0];

  // Reconcile capacity for display
  let balance = row.balance;
  if (row.last_reconciled_at) {
    const cap: CapacityRow = {
      agent_id: row.id,
      balance: row.balance,
      max_balance: row.max_balance,
      regen_per_hour: row.regen_per_hour,
      last_reconciled_at: row.last_reconciled_at,
      policy: {},
    };
    balance = reconcileCapacity(cap).newBalance;
  }

  return {
    agent: {
      id: row.id,
      handle: row.handle,
      status: row.status,
      deployment_target: row.deployment_target,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    capacity: {
      balance,
      max_balance: row.max_balance,
      regen_per_hour: row.regen_per_hour,
    },
  };
});

// --- Agent lifecycle ---

app.post('/agents/:id/archive', async (request, reply) => {
  const { id } = request.params as { id: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  const check = await pool.query('select status from agents where id = $1', [id]);
  if (check.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }
  if (check.rows[0].status === 'archived') {
    return { ok: true, status: 'archived' };
  }

  await pool.query(
    `update agents set status = 'archived', updated_at = now() where id = $1`,
    [id],
  );

  const evt = await appendEvent(
    'agent.archived',
    { agent_id: id },
    id,
    correlationId,
  );

  return { ok: true, status: 'archived', event: evt };
});

app.post('/agents/:id/redeploy', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { deployment_target?: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  const check = await pool.query('select status from agents where id = $1', [id]);
  if (check.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }

  await pool.query(
    `update agents set status = 'active', deployment_target = coalesce($2, deployment_target), updated_at = now() where id = $1`,
    [id, body.deployment_target ?? null],
  );

  const evt = await appendEvent(
    'agent.redeployed',
    { agent_id: id, deployment_target: body.deployment_target },
    id,
    correlationId,
  );

  return { ok: true, status: 'active', event: evt };
});

// --- Capacity management ---

app.get('/agents/:id/capacity', async (request, reply) => {
  const { id } = request.params as { id: string };

  const res = await pool.query(
    `select agent_id, balance, max_balance, regen_per_hour, last_reconciled_at, policy
     from agent_capacity where agent_id = $1`,
    [id],
  );
  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }

  const cap = res.rows[0] as CapacityRow;
  const { newBalance, reconciledAt } = reconcileCapacity(cap);

  // Persist reconciled balance
  await pool.query(
    `update agent_capacity set balance = $2, last_reconciled_at = $3 where agent_id = $1`,
    [id, newBalance, reconciledAt],
  );

  return {
    capacity: {
      balance: newBalance,
      max_balance: cap.max_balance,
      regen_per_hour: cap.regen_per_hour,
      last_reconciled_at: reconciledAt.toISOString(),
    },
  };
});

app.post('/agents/:id/capacity/allocate', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { amount: number };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  if (typeof body.amount !== 'number' || body.amount <= 0) {
    reply.status(400);
    return { error: 'amount must be a positive number' };
  }

  const res = await pool.query(
    `select agent_id, balance, max_balance, regen_per_hour, last_reconciled_at, policy
     from agent_capacity where agent_id = $1`,
    [id],
  );
  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }

  const cap = res.rows[0] as CapacityRow;
  const { newBalance } = reconcileCapacity(cap);
  const allocatedBalance = Math.min(newBalance + body.amount, cap.max_balance);
  const now = new Date();

  await pool.query(
    `update agent_capacity set balance = $2, last_reconciled_at = $3 where agent_id = $1`,
    [id, allocatedBalance, now],
  );

  const evt = await appendEvent(
    'agent.capacity_allocated',
    { agent_id: id, amount: body.amount, new_balance: allocatedBalance },
    id,
    correlationId,
  );

  return {
    capacity: {
      balance: allocatedBalance,
      max_balance: cap.max_balance,
      allocated: body.amount,
    },
    event: evt,
  };
});

// --- Action attempts ---

interface AttemptBody {
  action_type: string;
  requested_cost: number;
  payload?: Record<string, unknown>;
  idempotency_key?: string;
}

app.post('/agents/:id/attempt', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as AttemptBody;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = body.idempotency_key ?? (request.headers['x-idempotency-key'] as string | undefined);

  // Normalize action_type to lowercase
  const actionType = String(body.action_type ?? '').toLowerCase().trim() as ActionType;

  // Validate action type (server-side enforcement)
  if (!ACTION_TYPES.includes(actionType)) {
    request.log.warn({ action_type: body.action_type, normalized: actionType }, 'rejected unknown action_type');
    reply.status(400);
    return { error: 'invalid action_type', valid_types: ACTION_TYPES };
  }

  // Validate cost
  const cost = body.requested_cost;
  if (typeof cost !== 'number' || cost < 0) {
    reply.status(400);
    return { error: 'requested_cost must be a non-negative number' };
  }

  // Check agent exists and is active
  const agentCheck = await pool.query(
    'select status, deployment_target from agents where id = $1',
    [id],
  );
  if (agentCheck.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }
  if (agentCheck.rows[0].status !== 'active') {
    reply.status(400);
    return { error: 'agent not active', status: agentCheck.rows[0].status };
  }
  const deploymentTarget = agentCheck.rows[0].deployment_target;

  // Check idempotency (action-level) - return same event_id on replay
  if (idempotencyKey) {
    const existing = await pool.query(
      'select accepted, reason, event_id from agent_action_log where idempotency_key = $1',
      [idempotencyKey],
    );
    if (existing.rowCount && existing.rowCount > 0) {
      const row = existing.rows[0];
      // Fetch the original event to return the same event_id
      let eventData = null;
      if (row.event_id) {
        const evtRes = await pool.query('select * from events where event_id = $1', [row.event_id]);
        if (evtRes.rowCount && evtRes.rowCount > 0) {
          eventData = evtRes.rows[0];
        }
      }
      return {
        accepted: row.accepted,
        reason: row.reason ?? (row.accepted ? null : 'idempotent_replay'),
        idempotent: true,
        event: eventData,
      };
    }
  }

  // Get and reconcile capacity
  const capRes = await pool.query(
    `select agent_id, balance, max_balance, regen_per_hour, last_reconciled_at, policy
     from agent_capacity where agent_id = $1 for update`,
    [id],
  );
  if (capRes.rowCount === 0) {
    reply.status(500);
    return { error: 'capacity record missing' };
  }

  const cap = capRes.rows[0] as CapacityRow;
  const { newBalance, reconciledAt } = reconcileCapacity(cap);

  let accepted = false;
  let reason: string | null = null;
  let remainingBalance = newBalance;

  if (newBalance >= cost) {
    accepted = true;
    remainingBalance = newBalance - cost;
    reason = null;
  } else {
    accepted = false;
    reason = 'insufficient_capacity';
  }

  // Update capacity (only deduct if accepted)
  await pool.query(
    `update agent_capacity set balance = $2, last_reconciled_at = $3 where agent_id = $1`,
    [id, remainingBalance, reconciledAt],
  );

  // Truncate payload for storage
  const truncatedPayload = truncatePayload(body.payload);

  // Emit explicit outcome event: agent.action_accepted or agent.action_rejected
  const eventType = accepted ? 'agent.action_accepted' : 'agent.action_rejected';
  const evt = await appendEvent(
    eventType,
    {
      agent_id: id,
      deployment_target: deploymentTarget,
      action_type: actionType,
      requested_cost: cost,
      accepted,
      reason,
      remaining_balance: remainingBalance,
      payload: truncatedPayload ? JSON.parse(truncatedPayload) : null,
    },
    id,
    correlationId,
    idempotencyKey,
  );

  // Log the action with event_id for idempotent replay
  await pool.query(
    `insert into agent_action_log (agent_id, action_type, cost, accepted, reason, payload, idempotency_key, event_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, actionType, cost, accepted, reason, truncatedPayload, idempotencyKey ?? null, evt.event_id],
  );

  return {
    accepted,
    reason,
    remaining_balance: remainingBalance,
    event: evt,
  };
});

// --- Admin/debug endpoints ---
// NOTE: Ops auth is currently placeholder (x-ops-role header check only).
// In production, integrate with platform auth/RBAC system.

app.get('/admin/agents', async (request, reply) => {
  // PLACEHOLDER AUTH: In production, use proper RBAC via @platform/shared
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const query = request.query as { status?: string; limit?: string };
  const status = query.status;
  const limit = Number(query.limit ?? 50);

  const res = await pool.query(
    `select a.id, a.handle, a.status, a.deployment_target, a.created_at,
            c.balance, c.max_balance
     from agents a
     left join agent_capacity c on c.agent_id = a.id
     where ($1::text is null or a.status = $1::agent_status)
     order by a.created_at desc
     limit $2`,
    [status ?? null, limit],
  );
  return { agents: res.rows };
});

app.get('/admin/agents/:id/actions', async (request, reply) => {
  // PLACEHOLDER AUTH: In production, use proper RBAC via @platform/shared
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const { id } = request.params as { id: string };
  const query = request.query as { limit?: string };
  const limit = Number(query.limit ?? 50);

  const res = await pool.query(
    `select id, action_type, cost, accepted, reason, payload, event_id, created_at
     from agent_action_log
     where agent_id = $1
     order by created_at desc
     limit $2`,
    [id, limit],
  );
  return { actions: res.rows };
});

app.get('/admin/outbox', async (request, reply) => {
  // PLACEHOLDER AUTH: In production, use proper RBAC via @platform/shared
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const rows = await pool.query('select * from outbox');
  return { outbox: rows.rows };
});

// --- Outbox dispatcher ---

setInterval(() => {
  dispatchOutbox(pool, async (topic, payload) => publishEvent(topic, payload));
}, 10000);

// --- Start server ---

const start = async () => {
  const port = Number(process.env.PORT ?? 4017);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`agents service running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start agents service');
  process.exit(1);
});
