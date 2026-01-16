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
import { executeCognition, CognitionContext } from '@platform/cognition';

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

  // Check agent exists and is active, fetch cognition config
  const agentCheck = await pool.query(
    'select status, deployment_target, cognition_provider, throttle_profile from agents where id = $1',
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
  const cognitionProvider = agentCheck.rows[0].cognition_provider ?? 'none';
  const throttleProfile = agentCheck.rows[0].throttle_profile ?? 'normal';

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
  let cognitionData: {
    provider: string;
    tokens_used: number;
    estimated_cost: number;
    actual_cost: number;
    latency_ms: number;
  } | null = null;

  // Check if throttle is paused
  if (throttleProfile === 'paused') {
    accepted = false;
    reason = 'throttle_paused';
  } else {
    // Build cognition context
    const cognitionContext: CognitionContext = {
      agent_id: id,
      action_type: actionType,
      deployment_target: deploymentTarget ?? 'unknown',
      throttle_profile: throttleProfile as CognitionContext['throttle_profile'],
    };

    // Estimate total cost (base + cognition if applicable)
    let estimatedCognitionCost = 0;
    if (cognitionProvider !== 'none') {
      try {
        const { getProvider } = await import('@platform/cognition');
        const provider = getProvider(cognitionProvider);
        if (provider) {
          estimatedCognitionCost = provider.estimateCost(body.payload, cognitionContext);
        }
      } catch {
        // Provider not available, continue without cognition cost
      }
    }

    const totalCost = cost + estimatedCognitionCost;

    if (newBalance >= totalCost) {
      accepted = true;

      // Execute cognition if provider is configured
      if (cognitionProvider !== 'none') {
        try {
          const cognitionResult = await executeCognition(
            cognitionProvider,
            body.payload,
            cognitionContext,
          );
          if (cognitionResult) {
            cognitionData = {
              provider: cognitionProvider,
              tokens_used: cognitionResult.result.tokens_used,
              estimated_cost: cognitionResult.estimated_cost,
              actual_cost: cognitionResult.actual_cost,
              latency_ms: cognitionResult.result.latency_ms,
            };
            // Deduct actual cognition cost (may differ from estimate)
            remainingBalance = newBalance - cost - cognitionResult.actual_cost;
          } else {
            remainingBalance = newBalance - cost;
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : 'cognition_error';
          if (errMsg === 'cognition_paused') {
            accepted = false;
            reason = 'cognition_paused';
          } else {
            // Cognition failed but action can proceed without it
            request.log.warn({ err: errMsg }, 'cognition execution failed, proceeding without');
            remainingBalance = newBalance - cost;
          }
        }
      } else {
        remainingBalance = newBalance - cost;
      }

      if (accepted) {
        reason = null;
      }
    } else {
      accepted = false;
      reason = 'insufficient_capacity';
    }
  }

  // Update capacity (only deduct if accepted)
  await pool.query(
    `update agent_capacity set balance = $2, last_reconciled_at = $3 where agent_id = $1`,
    [id, accepted ? remainingBalance : newBalance, reconciledAt],
  );

  // Truncate payload for storage
  const truncatedPayload = truncatePayload(body.payload);

  // Build event payload with cognition data if present
  const eventPayload: Record<string, unknown> = {
    agent_id: id,
    deployment_target: deploymentTarget,
    action_type: actionType,
    requested_cost: cost,
    accepted,
    reason,
    remaining_balance: accepted ? remainingBalance : newBalance,
    payload: truncatedPayload ? JSON.parse(truncatedPayload) : null,
  };

  if (cognitionData) {
    eventPayload.cognition = cognitionData;
  }

  // Emit explicit outcome event: agent.action_accepted or agent.action_rejected
  const eventType = accepted ? 'agent.action_accepted' : 'agent.action_rejected';
  const evt = await appendEvent(
    eventType,
    eventPayload,
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

  const response: Record<string, unknown> = {
    accepted,
    reason,
    remaining_balance: accepted ? remainingBalance : newBalance,
    event: evt,
  };

  if (cognitionData) {
    response.cognition = cognitionData;
  }

  return response;
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

// --- Foundry Control Plane: Sponsor Powers (Phase 3) ---
// All sponsor influence is INDIRECT and AUDITED.
// Forbidden: direct messaging, forced actions, memory injection, visibility into private state.

const COGNITION_PROVIDERS = ['none', 'openai', 'anthropic', 'gemini'] as const;
type CognitionProvider = (typeof COGNITION_PROVIDERS)[number];

const THROTTLE_PROFILES = ['normal', 'conservative', 'aggressive', 'paused'] as const;
type ThrottleProfile = (typeof THROTTLE_PROFILES)[number];

/**
 * Audit a sponsor action to the sponsor_actions table.
 */
const auditSponsorAction = async (
  sponsorId: string,
  agentId: string,
  actionType: string,
  details: Record<string, unknown>,
  eventId?: string,
) => {
  await pool.query(
    `insert into sponsor_actions (sponsor_id, agent_id, action_type, details_json, event_id)
     values ($1, $2, $3, $4, $5)`,
    [sponsorId, agentId, actionType, JSON.stringify(details), eventId ?? null],
  );
};

// Assign or update sponsor for an agent
app.post('/agents/:id/sponsor', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { sponsor_id: string | null };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Validate sponsor_id
  if (body.sponsor_id !== null && typeof body.sponsor_id !== 'string') {
    reply.status(400);
    return { error: 'sponsor_id must be a string or null' };
  }

  // Check agent exists
  const check = await pool.query('select sponsor_id from agents where id = $1', [id]);
  if (check.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }
  const previousSponsor = check.rows[0].sponsor_id;

  // Update sponsor
  await pool.query(
    `update agents set sponsor_id = $2, updated_at = now() where id = $1`,
    [id, body.sponsor_id],
  );

  const evt = await appendEvent(
    'agent.sponsor_changed',
    {
      agent_id: id,
      previous_sponsor_id: previousSponsor,
      new_sponsor_id: body.sponsor_id,
    },
    body.sponsor_id ?? 'system',
    correlationId,
  );

  // Audit the action
  if (body.sponsor_id) {
    await auditSponsorAction(body.sponsor_id, id, 'sponsor_assigned', {
      previous_sponsor_id: previousSponsor,
    }, evt.event_id);
  }

  return { ok: true, sponsor_id: body.sponsor_id, event: evt };
});

// Get agent's sponsor info and control plane state
app.get('/agents/:id/sponsor', async (request, reply) => {
  const { id } = request.params as { id: string };

  const res = await pool.query(
    `select sponsor_id, cognition_provider, throttle_profile from agents where id = $1`,
    [id],
  );
  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }

  const row = res.rows[0];
  return {
    sponsor_id: row.sponsor_id,
    cognition_provider: row.cognition_provider,
    throttle_profile: row.throttle_profile,
  };
});

// Sponsor power: Allocate capacity to agent
app.post('/sponsor/:sponsorId/agents/:id/allocate', async (request, reply) => {
  const { sponsorId, id } = request.params as { sponsorId: string; id: string };
  const body = request.body as { amount: number };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Validate amount
  if (typeof body.amount !== 'number') {
    reply.status(400);
    return { error: 'amount must be a number' };
  }

  // Check agent exists and sponsor matches
  const check = await pool.query('select sponsor_id from agents where id = $1', [id]);
  if (check.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }
  if (check.rows[0].sponsor_id !== sponsorId) {
    reply.status(403);
    return { error: 'sponsor_id does not match agent sponsor' };
  }

  // Get capacity
  const capRes = await pool.query(
    `select balance, max_balance, regen_per_hour, last_reconciled_at, policy
     from agent_capacity where agent_id = $1 for update`,
    [id],
  );
  if (capRes.rowCount === 0) {
    reply.status(500);
    return { error: 'capacity record missing' };
  }

  const cap = capRes.rows[0] as CapacityRow;
  const { newBalance, reconciledAt } = reconcileCapacity({ ...cap, agent_id: id });

  // Apply allocation (can be negative for removal)
  const adjustedBalance = Math.max(0, Math.min(newBalance + body.amount, cap.max_balance));

  await pool.query(
    `update agent_capacity set balance = $2, last_reconciled_at = $3 where agent_id = $1`,
    [id, adjustedBalance, reconciledAt],
  );

  const evt = await appendEvent(
    'agent.sponsor_capacity_adjusted',
    {
      agent_id: id,
      sponsor_id: sponsorId,
      amount: body.amount,
      previous_balance: newBalance,
      new_balance: adjustedBalance,
    },
    sponsorId,
    correlationId,
  );

  // Audit the action
  await auditSponsorAction(sponsorId, id, 'capacity_adjusted', {
    amount: body.amount,
    previous_balance: newBalance,
    new_balance: adjustedBalance,
  }, evt.event_id);

  return {
    ok: true,
    capacity: {
      previous_balance: newBalance,
      new_balance: adjustedBalance,
      max_balance: cap.max_balance,
    },
    event: evt,
  };
});

// Sponsor power: Select cognition provider for agent
app.post('/sponsor/:sponsorId/agents/:id/cognition', async (request, reply) => {
  const { sponsorId, id } = request.params as { sponsorId: string; id: string };
  const body = request.body as { provider: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Validate provider
  const provider = String(body.provider ?? '').toLowerCase().trim() as CognitionProvider;
  if (!COGNITION_PROVIDERS.includes(provider)) {
    reply.status(400);
    return { error: 'invalid cognition provider', valid_providers: COGNITION_PROVIDERS };
  }

  // Check agent exists and sponsor matches
  const check = await pool.query('select sponsor_id, cognition_provider from agents where id = $1', [id]);
  if (check.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }
  if (check.rows[0].sponsor_id !== sponsorId) {
    reply.status(403);
    return { error: 'sponsor_id does not match agent sponsor' };
  }
  const previousProvider = check.rows[0].cognition_provider;

  // Update cognition provider
  await pool.query(
    `update agents set cognition_provider = $2::cognition_provider, updated_at = now() where id = $1`,
    [id, provider],
  );

  const evt = await appendEvent(
    'agent.cognition_provider_changed',
    {
      agent_id: id,
      sponsor_id: sponsorId,
      previous_provider: previousProvider,
      new_provider: provider,
    },
    sponsorId,
    correlationId,
  );

  // Audit the action
  await auditSponsorAction(sponsorId, id, 'cognition_provider_changed', {
    previous_provider: previousProvider,
    new_provider: provider,
  }, evt.event_id);

  return { ok: true, cognition_provider: provider, event: evt };
});

// Sponsor power: Set throttle profile for agent
app.post('/sponsor/:sponsorId/agents/:id/throttle', async (request, reply) => {
  const { sponsorId, id } = request.params as { sponsorId: string; id: string };
  const body = request.body as { profile: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Validate profile
  const profile = String(body.profile ?? '').toLowerCase().trim() as ThrottleProfile;
  if (!THROTTLE_PROFILES.includes(profile)) {
    reply.status(400);
    return { error: 'invalid throttle profile', valid_profiles: THROTTLE_PROFILES };
  }

  // Check agent exists and sponsor matches
  const check = await pool.query('select sponsor_id, throttle_profile from agents where id = $1', [id]);
  if (check.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }
  if (check.rows[0].sponsor_id !== sponsorId) {
    reply.status(403);
    return { error: 'sponsor_id does not match agent sponsor' };
  }
  const previousProfile = check.rows[0].throttle_profile;

  // Update throttle profile
  await pool.query(
    `update agents set throttle_profile = $2::throttle_profile, updated_at = now() where id = $1`,
    [id, profile],
  );

  const evt = await appendEvent(
    'agent.throttle_profile_changed',
    {
      agent_id: id,
      sponsor_id: sponsorId,
      previous_profile: previousProfile,
      new_profile: profile,
    },
    sponsorId,
    correlationId,
  );

  // Audit the action
  await auditSponsorAction(sponsorId, id, 'throttle_profile_changed', {
    previous_profile: previousProfile,
    new_profile: profile,
  }, evt.event_id);

  return { ok: true, throttle_profile: profile, event: evt };
});

// Sponsor power: Redeploy agent
app.post('/sponsor/:sponsorId/agents/:id/redeploy', async (request, reply) => {
  const { sponsorId, id } = request.params as { sponsorId: string; id: string };
  const body = request.body as { deployment_target?: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Check agent exists and sponsor matches
  const check = await pool.query('select sponsor_id, status, deployment_target from agents where id = $1', [id]);
  if (check.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }
  if (check.rows[0].sponsor_id !== sponsorId) {
    reply.status(403);
    return { error: 'sponsor_id does not match agent sponsor' };
  }
  const previousTarget = check.rows[0].deployment_target;

  // Redeploy (reactivate and optionally change target)
  await pool.query(
    `update agents set status = 'active', deployment_target = coalesce($2, deployment_target), updated_at = now() where id = $1`,
    [id, body.deployment_target ?? null],
  );

  const evt = await appendEvent(
    'agent.sponsor_redeployed',
    {
      agent_id: id,
      sponsor_id: sponsorId,
      previous_deployment_target: previousTarget,
      new_deployment_target: body.deployment_target ?? previousTarget,
    },
    sponsorId,
    correlationId,
  );

  // Audit the action
  await auditSponsorAction(sponsorId, id, 'redeployed', {
    previous_deployment_target: previousTarget,
    new_deployment_target: body.deployment_target ?? previousTarget,
  }, evt.event_id);

  return {
    ok: true,
    status: 'active',
    deployment_target: body.deployment_target ?? previousTarget,
    event: evt,
  };
});

// Admin: View sponsor action audit log
app.get('/admin/sponsors/:sponsorId/actions', async (request, reply) => {
  // PLACEHOLDER AUTH: In production, use proper RBAC via @platform/shared
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const { sponsorId } = request.params as { sponsorId: string };
  const query = request.query as { limit?: string };
  const limit = Number(query.limit ?? 50);

  const res = await pool.query(
    `select id, agent_id, action_type, details_json, event_id, created_at
     from sponsor_actions
     where sponsor_id = $1
     order by created_at desc
     limit $2`,
    [sponsorId, limit],
  );
  return { actions: res.rows };
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
