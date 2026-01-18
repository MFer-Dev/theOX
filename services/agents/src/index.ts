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

// Extended action types including inter-agent perception (Axis 1)
const ACTION_TYPES = [
  'communicate',
  'associate',
  'create',
  'exchange',
  'conflict',
  'withdraw',
  // Inter-agent perception types (non-communicative)
  'critique',
  'counter_model',
  'refusal',
  'rederivation',
] as const;
type ActionType = (typeof ACTION_TYPES)[number];

// Artifact types that implicate other agents
const IMPLICATING_ARTIFACT_TYPES = ['critique', 'counter_model', 'refusal', 'rederivation'] as const;

// Environment state types
interface EnvironmentState {
  deployment_target: string;
  cognition_availability: 'full' | 'degraded' | 'unavailable';
  max_throughput_per_minute: number | null;
  throttle_factor: number;
  active_window_start: Date | null;
  active_window_end: Date | null;
  imposed_at: Date;
  reason: string | null;
}

// --- Environment constraint helpers (Axis 2) ---

/**
 * Check environment constraints for a deployment target.
 * Returns rejection reason if action should be blocked, null otherwise.
 */
const checkEnvironmentConstraints = async (
  deploymentTarget: string,
): Promise<{ allowed: boolean; reason: string | null; state: EnvironmentState | null }> => {
  // Get current environment state
  const stateRes = await pool.query(
    `select * from environment_states where deployment_target = $1`,
    [deploymentTarget],
  );

  if (stateRes.rowCount === 0) {
    // No constraints defined for this deployment
    return { allowed: true, reason: null, state: null };
  }

  const state = stateRes.rows[0] as EnvironmentState;

  // Check active window
  const now = new Date();
  if (state.active_window_start && state.active_window_end) {
    if (now < state.active_window_start || now > state.active_window_end) {
      return {
        allowed: false,
        reason: 'environment_outside_active_window',
        state,
      };
    }
  }

  // Check cognition availability
  if (state.cognition_availability === 'unavailable') {
    return {
      allowed: false,
      reason: 'environment_cognition_unavailable',
      state,
    };
  }

  // Check throughput limits
  if (state.max_throughput_per_minute) {
    const windowStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
    const throughputRes = await pool.query(
      `select action_count from deployment_throughput
       where deployment_target = $1 and window_start = $2`,
      [deploymentTarget, windowStart],
    );

    const currentCount = throughputRes.rows[0]?.action_count ?? 0;
    if (currentCount >= state.max_throughput_per_minute) {
      return {
        allowed: false,
        reason: 'environment_throughput_exceeded',
        state,
      };
    }
  }

  return { allowed: true, reason: null, state };
};

/**
 * Increment throughput counter for a deployment target.
 */
const incrementThroughput = async (deploymentTarget: string): Promise<void> => {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 60000) * 60000);

  await pool.query(
    `insert into deployment_throughput (deployment_target, window_start, action_count)
     values ($1, $2, 1)
     on conflict (deployment_target, window_start)
     do update set action_count = deployment_throughput.action_count + 1`,
    [deploymentTarget, windowStart],
  );
};

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

    // Phase 12: Assign locality memberships for this agent
    await assignLocalityMembership(agent.id, agent.deployment_target, correlationId);

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
  // Axis 1: Inter-agent perception - optional subject agent reference
  subject_agent_id?: string;
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

  // Axis 1: Validate subject_agent_id for implicating action types
  const subjectAgentId = body.subject_agent_id ?? null;
  const isImplicatingAction = IMPLICATING_ARTIFACT_TYPES.includes(actionType as typeof IMPLICATING_ARTIFACT_TYPES[number]);

  if (isImplicatingAction && !subjectAgentId) {
    reply.status(400);
    return {
      error: 'subject_agent_id required for implicating action types',
      action_type: actionType,
      implicating_types: IMPLICATING_ARTIFACT_TYPES,
    };
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

  // Axis 2: Check environment constraints
  const envCheck = await checkEnvironmentConstraints(deploymentTarget ?? 'default');
  if (!envCheck.allowed) {
    // Emit environment rejection event
    const envEvt = await appendEvent(
      'agent.action_rejected.environment',
      {
        agent_id: id,
        deployment_target: deploymentTarget,
        action_type: actionType,
        requested_cost: cost,
        rejection_reason: envCheck.reason,
        environment_state: envCheck.state,
      },
      id,
      correlationId,
    );

    return {
      accepted: false,
      reason: envCheck.reason,
      environment_constraint: true,
      environment_state: envCheck.state,
      event: envEvt,
    };
  }

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

  // Build event payload with cognition data and subject_agent_id if present
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

  // Axis 1: Include subject_agent_id for inter-agent perception
  if (subjectAgentId) {
    eventPayload.subject_agent_id = subjectAgentId;
  }

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

  // Axis 1: Emit artifact events for accepted implicating actions
  if (accepted && isImplicatingAction && subjectAgentId) {
    // Emit ox.artifact.issued
    await appendEvent(
      'ox.artifact.issued',
      {
        issuing_agent_id: id,
        artifact_type: actionType,
        deployment_target: deploymentTarget,
        source_event_id: evt.event_id,
      },
      id,
      correlationId,
    );

    // Emit ox.artifact.implicates_agent
    await appendEvent(
      'ox.artifact.implicates_agent',
      {
        issuing_agent_id: id,
        subject_agent_id: subjectAgentId,
        artifact_type: actionType,
        implication_type: actionType,
        deployment_target: deploymentTarget,
        source_event_id: evt.event_id,
      },
      id,
      correlationId,
    );
  }

  // Axis 2: Increment throughput counter for accepted actions
  if (accepted && deploymentTarget) {
    await incrementThroughput(deploymentTarget);
  }

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

  // Include subject_agent_id in response
  if (subjectAgentId) {
    response.subject_agent_id = subjectAgentId;
  }

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

// --- Axis 2: Environment State Management (Admin) ---
// Environment constraints are physics, not moderation.
// These endpoints allow ops to impose scarcity conditions.

interface EnvironmentStateBody {
  deployment_target: string;
  cognition_availability?: 'full' | 'degraded' | 'unavailable';
  max_throughput_per_minute?: number | null;
  throttle_factor?: number;
  active_window_start?: string | null;
  active_window_end?: string | null;
  reason?: string;
}

app.get('/admin/environment', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const res = await pool.query(
    `select deployment_target, cognition_availability, max_throughput_per_minute,
            throttle_factor, active_window_start, active_window_end, imposed_at, reason
     from environment_states
     order by deployment_target`,
  );

  return { environment_states: res.rows };
});

app.get('/admin/environment/:target', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const { target } = request.params as { target: string };

  const res = await pool.query(
    `select deployment_target, cognition_availability, max_throughput_per_minute,
            throttle_factor, active_window_start, active_window_end, imposed_at, reason
     from environment_states
     where deployment_target = $1`,
    [target],
  );

  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'environment state not found' };
  }

  // Get recent throughput data
  const throughputRes = await pool.query(
    `select window_start, action_count
     from deployment_throughput
     where deployment_target = $1
     order by window_start desc
     limit 60`,
    [target],
  );

  return {
    environment_state: res.rows[0],
    recent_throughput: throughputRes.rows,
  };
});

app.put('/admin/environment/:target', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const { target } = request.params as { target: string };
  const body = request.body as EnvironmentStateBody;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Validate cognition_availability
  const validAvailability = ['full', 'degraded', 'unavailable'] as const;
  const cogAvailability = body.cognition_availability ?? 'full';
  if (!validAvailability.includes(cogAvailability)) {
    reply.status(400);
    return { error: 'invalid cognition_availability', valid: validAvailability };
  }

  // Validate throttle_factor
  const throttleFactor = body.throttle_factor ?? 1.0;
  if (throttleFactor < 0 || throttleFactor > 10) {
    reply.status(400);
    return { error: 'throttle_factor must be between 0 and 10' };
  }

  // Parse active window timestamps
  const activeStart = body.active_window_start ? new Date(body.active_window_start) : null;
  const activeEnd = body.active_window_end ? new Date(body.active_window_end) : null;

  // Get previous state for event
  const prevRes = await pool.query(
    `select * from environment_states where deployment_target = $1`,
    [target],
  );
  const previousState = prevRes.rows[0] ?? null;

  // Upsert environment state
  await pool.query(
    `insert into environment_states (
       deployment_target, cognition_availability, max_throughput_per_minute,
       throttle_factor, active_window_start, active_window_end, imposed_at, reason
     ) values ($1, $2::cognition_availability, $3, $4, $5, $6, now(), $7)
     on conflict (deployment_target)
     do update set
       cognition_availability = $2::cognition_availability,
       max_throughput_per_minute = $3,
       throttle_factor = $4,
       active_window_start = $5,
       active_window_end = $6,
       imposed_at = now(),
       reason = $7`,
    [
      target,
      cogAvailability,
      body.max_throughput_per_minute ?? null,
      throttleFactor,
      activeStart,
      activeEnd,
      body.reason ?? null,
    ],
  );

  // Emit environment state changed event
  const evt = await appendEvent(
    'environment.state_changed',
    {
      deployment_target: target,
      previous_state: previousState,
      new_state: {
        cognition_availability: cogAvailability,
        max_throughput_per_minute: body.max_throughput_per_minute ?? null,
        throttle_factor: throttleFactor,
        active_window_start: activeStart?.toISOString() ?? null,
        active_window_end: activeEnd?.toISOString() ?? null,
        reason: body.reason ?? null,
      },
    },
    'system',
    correlationId,
  );

  return {
    ok: true,
    deployment_target: target,
    environment_state: {
      cognition_availability: cogAvailability,
      max_throughput_per_minute: body.max_throughput_per_minute ?? null,
      throttle_factor: throttleFactor,
      active_window_start: activeStart?.toISOString() ?? null,
      active_window_end: activeEnd?.toISOString() ?? null,
    },
    event: evt,
  };
});

app.delete('/admin/environment/:target', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const { target } = request.params as { target: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Get current state for event
  const prevRes = await pool.query(
    `select * from environment_states where deployment_target = $1`,
    [target],
  );

  if (prevRes.rowCount === 0) {
    reply.status(404);
    return { error: 'environment state not found' };
  }

  // Delete environment state (removes all constraints)
  await pool.query(
    `delete from environment_states where deployment_target = $1`,
    [target],
  );

  // Emit environment state removed event
  const evt = await appendEvent(
    'environment.state_removed',
    {
      deployment_target: target,
      previous_state: prevRes.rows[0],
    },
    'system',
    correlationId,
  );

  return {
    ok: true,
    deployment_target: target,
    event: evt,
  };
});

// Get throughput statistics for a deployment
app.get('/admin/environment/:target/throughput', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const { target } = request.params as { target: string };
  const query = request.query as { minutes?: string };
  const minutes = Math.min(Number(query.minutes) || 60, 1440); // Max 24 hours

  const windowStart = new Date(Date.now() - minutes * 60 * 1000);

  const res = await pool.query(
    `select window_start, action_count
     from deployment_throughput
     where deployment_target = $1 and window_start >= $2
     order by window_start desc`,
    [target, windowStart],
  );

  const totalActions = res.rows.reduce((sum, row) => sum + row.action_count, 0);
  const avgPerMinute = res.rowCount && res.rowCount > 0
    ? totalActions / res.rowCount
    : 0;

  return {
    deployment_target: target,
    window_minutes: minutes,
    total_actions: totalActions,
    avg_actions_per_minute: Math.round(avgPerMinute * 100) / 100,
    data_points: res.rows,
  };
});

// --- Outbox dispatcher ---

setInterval(() => {
  dispatchOutbox(pool, async (topic, payload) => publishEvent(topic, payload));
}, 10000);

// ============================================================================
// PHASE 7: Sponsor Sweep Policies (curling sweep layer)
// ============================================================================

const POLICY_TYPES = ['capacity', 'cognition', 'throttle', 'redeploy'] as const;
type PolicyType = (typeof POLICY_TYPES)[number];

interface PolicyRule {
  if: Array<{
    field: string;
    op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in';
    value: unknown;
  }>;
  then: {
    action: string;
    params: Record<string, unknown>;
  };
}

interface SponsorPolicy {
  id: string;
  sponsor_id: string;
  policy_type: PolicyType;
  rules_json: PolicyRule[];
  cadence_seconds: number;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Evaluate a policy predicate against context.
 */
const evaluatePredicate = (
  predicate: PolicyRule['if'][0],
  context: Record<string, unknown>,
): boolean => {
  const parts = predicate.field.split('.');
  let value: unknown = context;
  for (const part of parts) {
    if (value && typeof value === 'object') {
      value = (value as Record<string, unknown>)[part];
    } else {
      value = undefined;
      break;
    }
  }

  switch (predicate.op) {
    case 'eq':
      return value === predicate.value;
    case 'neq':
      return value !== predicate.value;
    case 'gt':
      return typeof value === 'number' && value > (predicate.value as number);
    case 'gte':
      return typeof value === 'number' && value >= (predicate.value as number);
    case 'lt':
      return typeof value === 'number' && value < (predicate.value as number);
    case 'lte':
      return typeof value === 'number' && value <= (predicate.value as number);
    case 'in':
      return Array.isArray(predicate.value) && predicate.value.includes(value);
    case 'not_in':
      return Array.isArray(predicate.value) && !predicate.value.includes(value);
    default:
      return false;
  }
};

/**
 * Evaluate all rules in a policy against context.
 * Returns the first matching rule's action or null.
 */
const evaluatePolicy = (
  rules: PolicyRule[],
  context: Record<string, unknown>,
): PolicyRule['then'] | null => {
  for (const rule of rules) {
    const allMatch = rule.if.every((pred) => evaluatePredicate(pred, context));
    if (allMatch) {
      return rule.then;
    }
  }
  return null;
};

/**
 * Apply a policy action to an agent.
 */
const applyPolicyAction = async (
  policy: SponsorPolicy,
  agentId: string,
  action: PolicyRule['then'],
  tickId: string,
  correlationId: string,
): Promise<{ applied: boolean; reason: string; diff: Record<string, unknown> }> => {
  const diff: Record<string, unknown> = {};

  switch (policy.policy_type) {
    case 'capacity': {
      if (action.action !== 'allocate_delta') {
        return { applied: false, reason: 'invalid_action_for_policy_type', diff };
      }
      const delta = Number(action.params.delta ?? 0);
      if (delta === 0) {
        return { applied: false, reason: 'delta_is_zero', diff };
      }

      // Get current capacity
      const capRes = await pool.query(
        `select balance, max_balance from agent_capacity where agent_id = $1 for update`,
        [agentId],
      );
      if (capRes.rowCount === 0) {
        return { applied: false, reason: 'agent_capacity_not_found', diff };
      }

      const { balance, max_balance } = capRes.rows[0];
      const newBalance = Math.max(0, Math.min(balance + delta, max_balance));

      if (newBalance === balance) {
        return { applied: false, reason: 'no_change_within_bounds', diff };
      }

      await pool.query(
        `update agent_capacity set balance = $2, last_reconciled_at = now() where agent_id = $1`,
        [agentId, newBalance],
      );

      diff.previous_balance = balance;
      diff.new_balance = newBalance;
      diff.delta = delta;
      break;
    }

    case 'cognition': {
      if (action.action !== 'set_provider') {
        return { applied: false, reason: 'invalid_action_for_policy_type', diff };
      }
      const provider = String(action.params.provider ?? 'none');
      if (!COGNITION_PROVIDERS.includes(provider as CognitionProvider)) {
        return { applied: false, reason: 'invalid_provider', diff };
      }

      const prevRes = await pool.query(
        `select cognition_provider from agents where id = $1`,
        [agentId],
      );
      const previousProvider = prevRes.rows[0]?.cognition_provider;

      if (previousProvider === provider) {
        return { applied: false, reason: 'provider_unchanged', diff };
      }

      await pool.query(
        `update agents set cognition_provider = $2::cognition_provider, updated_at = now() where id = $1`,
        [agentId, provider],
      );

      diff.previous_provider = previousProvider;
      diff.new_provider = provider;
      break;
    }

    case 'throttle': {
      if (action.action !== 'set_profile') {
        return { applied: false, reason: 'invalid_action_for_policy_type', diff };
      }
      const profile = String(action.params.profile ?? 'normal');
      if (!THROTTLE_PROFILES.includes(profile as ThrottleProfile)) {
        return { applied: false, reason: 'invalid_profile', diff };
      }

      const prevRes = await pool.query(
        `select throttle_profile from agents where id = $1`,
        [agentId],
      );
      const previousProfile = prevRes.rows[0]?.throttle_profile;

      if (previousProfile === profile) {
        return { applied: false, reason: 'profile_unchanged', diff };
      }

      await pool.query(
        `update agents set throttle_profile = $2::throttle_profile, updated_at = now() where id = $1`,
        [agentId, profile],
      );

      diff.previous_profile = previousProfile;
      diff.new_profile = profile;
      break;
    }

    case 'redeploy': {
      if (action.action !== 'redeploy') {
        return { applied: false, reason: 'invalid_action_for_policy_type', diff };
      }
      const target = String(action.params.deployment_target ?? '');
      if (!target) {
        return { applied: false, reason: 'deployment_target_required', diff };
      }

      // Check environment allows this target
      const envRes = await pool.query(
        `select cognition_availability from environment_states where deployment_target = $1`,
        [target],
      );
      if (envRes.rowCount && envRes.rowCount > 0 && envRes.rows[0].cognition_availability === 'unavailable') {
        return { applied: false, reason: 'target_environment_unavailable', diff };
      }

      const prevRes = await pool.query(
        `select deployment_target from agents where id = $1`,
        [agentId],
      );
      const previousTarget = prevRes.rows[0]?.deployment_target;

      await pool.query(
        `update agents set deployment_target = $2, status = 'active', updated_at = now() where id = $1`,
        [agentId, target],
      );

      diff.previous_target = previousTarget;
      diff.new_target = target;
      break;
    }
  }

  // Emit policy applied event
  await appendEvent(
    'agent.sponsor_policy_applied',
    {
      policy_id: policy.id,
      sponsor_id: policy.sponsor_id,
      agent_id: agentId,
      policy_type: policy.policy_type,
      action: action.action,
      params: action.params,
      diff,
      source_tick_id: tickId,
    },
    policy.sponsor_id,
    correlationId,
  );

  return { applied: true, reason: 'policy_applied', diff };
};

/**
 * Policy runner: executes policies on cadence.
 */
const runPolicyTick = async (): Promise<void> => {
  const tickId = crypto.randomUUID();
  const correlationId = `policy-tick-${tickId}`;
  const now = new Date();

  // Find policies due for execution
  const policiesRes = await pool.query(`
    select p.*,
           coalesce(max(r.ran_at), p.created_at) as last_run
    from sponsor_policies p
    left join sponsor_policy_runs r on r.policy_id = p.id
    where p.active = true
    group by p.id
    having (extract(epoch from now() - coalesce(max(r.ran_at), p.created_at))) >= p.cadence_seconds
  `);

  for (const policyRow of policiesRes.rows) {
    const policy = policyRow as SponsorPolicy & { last_run: Date };

    try {
      // Get agents sponsored by this sponsor
      const agentsRes = await pool.query(
        `select a.id, a.status, a.deployment_target, a.cognition_provider, a.throttle_profile,
                c.balance, c.max_balance
         from agents a
         left join agent_capacity c on c.agent_id = a.id
         where a.sponsor_id = $1 and a.status = 'active'`,
        [policy.sponsor_id],
      );

      for (const agent of agentsRes.rows) {
        // Build context for rule evaluation
        const envRes = await pool.query(
          `select * from environment_states where deployment_target = $1`,
          [agent.deployment_target ?? 'default'],
        );
        const envState = envRes.rows[0] ?? {
          cognition_availability: 'full',
          throttle_factor: 1.0,
          weather_state: 'clear',
        };

        const context = {
          agent: {
            id: agent.id,
            status: agent.status,
            deployment_target: agent.deployment_target,
            cognition_provider: agent.cognition_provider,
            throttle_profile: agent.throttle_profile,
            remaining_balance: agent.balance,
            max_balance: agent.max_balance,
          },
          env: {
            cognition_availability: envState.cognition_availability,
            throttle_factor: envState.throttle_factor,
            weather_state: envState.weather_state ?? 'clear',
          },
        };

        // Evaluate policy rules
        const rules = Array.isArray(policy.rules_json) ? policy.rules_json : [];
        const action = evaluatePolicy(rules, context);

        if (action) {
          // Check idempotency
          const existingRun = await pool.query(
            `select id from sponsor_policy_runs where policy_id = $1 and source_tick_id = $2`,
            [policy.id, tickId],
          );
          if (existingRun.rowCount && existingRun.rowCount > 0) {
            continue; // Already processed this tick
          }

          const result = await applyPolicyAction(policy, agent.id, action, tickId, correlationId);

          // Record policy run
          await pool.query(
            `insert into sponsor_policy_runs (policy_id, ran_at, outcome_json, applied, reason, source_tick_id)
             values ($1, $2, $3, $4, $5, $6)
             on conflict (policy_id, source_tick_id) do nothing`,
            [policy.id, now, JSON.stringify({ agent_id: agent.id, action, result }), result.applied, result.reason, tickId],
          );

          if (!result.applied) {
            // Emit skipped event
            await appendEvent(
              'agent.sponsor_policy_skipped',
              {
                policy_id: policy.id,
                sponsor_id: policy.sponsor_id,
                agent_id: agent.id,
                policy_type: policy.policy_type,
                reason: result.reason,
                source_tick_id: tickId,
              },
              policy.sponsor_id,
              correlationId,
            );
          }
        }
      }
    } catch (err) {
      console.error(`Policy ${policy.id} execution error:`, err);
    }
  }
};

// Policy runner interval (60 seconds)
setInterval(() => {
  runPolicyTick().catch((err) => console.error('Policy tick error:', err));
}, 60000);

// --- Phase 7: Sponsor Policy APIs ---

app.post('/sponsor/:sponsorId/policies', async (request, reply) => {
  const { sponsorId } = request.params as { sponsorId: string };
  const body = request.body as {
    policy_type: string;
    rules: PolicyRule[];
    cadence_seconds: number;
  };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;

  // Validate policy_type
  const policyType = String(body.policy_type ?? '').toLowerCase().trim() as PolicyType;
  if (!POLICY_TYPES.includes(policyType)) {
    reply.status(400);
    return { error: 'invalid policy_type', valid_types: POLICY_TYPES };
  }

  // Validate cadence
  const cadence = Number(body.cadence_seconds ?? 0);
  if (cadence < 60) {
    reply.status(400);
    return { error: 'cadence_seconds must be at least 60' };
  }

  // Validate rules
  if (!Array.isArray(body.rules) || body.rules.length === 0) {
    reply.status(400);
    return { error: 'rules must be a non-empty array' };
  }

  const result = await withIdempotency(pool, idempotencyKey, async () => {
    const res = await pool.query(
      `insert into sponsor_policies (sponsor_id, policy_type, rules_json, cadence_seconds)
       values ($1, $2::sponsor_policy_type, $3, $4)
       returning *`,
      [sponsorId, policyType, JSON.stringify(body.rules), cadence],
    );

    const policy = res.rows[0];

    const evt = await appendEvent(
      'sponsor.policy_created',
      {
        policy_id: policy.id,
        sponsor_id: sponsorId,
        policy_type: policyType,
        cadence_seconds: cadence,
      },
      sponsorId,
      correlationId,
      idempotencyKey,
    );

    return { policy, event: evt };
  });

  reply.status(201);
  return result;
});

app.get('/sponsor/:sponsorId/policies', async (request) => {
  const { sponsorId } = request.params as { sponsorId: string };
  const query = request.query as { active?: string };

  const activeFilter = query.active === 'false' ? false : query.active === 'true' ? true : null;

  const res = await pool.query(
    `select * from sponsor_policies
     where sponsor_id = $1 ${activeFilter !== null ? 'and active = $2' : ''}
     order by created_at desc`,
    activeFilter !== null ? [sponsorId, activeFilter] : [sponsorId],
  );

  return { policies: res.rows };
});

app.put('/sponsor/:sponsorId/policies/:policyId', async (request, reply) => {
  const { sponsorId, policyId } = request.params as { sponsorId: string; policyId: string };
  const body = request.body as {
    rules?: PolicyRule[];
    cadence_seconds?: number;
  };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Check policy exists and belongs to sponsor
  const check = await pool.query(
    `select * from sponsor_policies where id = $1 and sponsor_id = $2`,
    [policyId, sponsorId],
  );
  if (check.rowCount === 0) {
    reply.status(404);
    return { error: 'policy not found' };
  }

  const updates: string[] = [];
  const values: unknown[] = [policyId];
  let paramIndex = 2;

  if (body.rules) {
    updates.push(`rules_json = $${paramIndex++}`);
    values.push(JSON.stringify(body.rules));
  }
  if (body.cadence_seconds !== undefined) {
    if (body.cadence_seconds < 60) {
      reply.status(400);
      return { error: 'cadence_seconds must be at least 60' };
    }
    updates.push(`cadence_seconds = $${paramIndex++}`);
    values.push(body.cadence_seconds);
  }

  if (updates.length === 0) {
    return { policy: check.rows[0] };
  }

  updates.push('updated_at = now()');

  const res = await pool.query(
    `update sponsor_policies set ${updates.join(', ')} where id = $1 returning *`,
    values,
  );

  await appendEvent(
    'sponsor.policy_updated',
    {
      policy_id: policyId,
      sponsor_id: sponsorId,
      changes: body,
    },
    sponsorId,
    correlationId,
  );

  return { policy: res.rows[0] };
});

app.post('/sponsor/:sponsorId/policies/:policyId/disable', async (request, reply) => {
  const { sponsorId, policyId } = request.params as { sponsorId: string; policyId: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  const check = await pool.query(
    `select * from sponsor_policies where id = $1 and sponsor_id = $2`,
    [policyId, sponsorId],
  );
  if (check.rowCount === 0) {
    reply.status(404);
    return { error: 'policy not found' };
  }

  await pool.query(
    `update sponsor_policies set active = false, updated_at = now() where id = $1`,
    [policyId],
  );

  await appendEvent(
    'sponsor.policy_disabled',
    {
      policy_id: policyId,
      sponsor_id: sponsorId,
    },
    sponsorId,
    correlationId,
  );

  return { ok: true, policy_id: policyId, active: false };
});

app.get('/admin/sponsors/:sponsorId/policy-runs', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const { sponsorId } = request.params as { sponsorId: string };
  const query = request.query as { limit?: string };
  const limit = Number(query.limit ?? 50);

  const res = await pool.query(
    `select r.*, p.policy_type, p.sponsor_id
     from sponsor_policy_runs r
     join sponsor_policies p on p.id = r.policy_id
     where p.sponsor_id = $1
     order by r.ran_at desc
     limit $2`,
    [sponsorId, limit],
  );

  return { runs: res.rows };
});

// ============================================================================
// PHASE 9: Closed-Loop Economy v1 (Credits)
// ============================================================================

// Sponsor credits: Purchase (stub - no payment integration)
app.post('/sponsor/:sponsorId/credits/purchase', async (request, reply) => {
  const { sponsorId } = request.params as { sponsorId: string };
  const body = request.body as { amount: number };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;

  const amount = Number(body.amount ?? 0);
  if (amount <= 0) {
    reply.status(400);
    return { error: 'amount must be positive' };
  }

  const result = await withIdempotency(pool, idempotencyKey, async () => {
    // Upsert sponsor wallet
    await pool.query(
      `insert into sponsor_wallets (sponsor_id, balance, updated_at)
       values ($1, $2, now())
       on conflict (sponsor_id)
       do update set balance = sponsor_wallets.balance + $2, updated_at = now()`,
      [sponsorId, amount],
    );

    // Record treasury entry
    await pool.query(
      `insert into treasury_ledger (type, amount, actor, memo)
       values ('mint', $1, 'system', $2)`,
      [amount, `Purchase stub for sponsor ${sponsorId}`],
    );

    // Record credit transaction
    await pool.query(
      `insert into credit_transactions (sponsor_id, type, amount, idempotency_key)
       values ($1, 'purchase_stub', $2, $3)`,
      [sponsorId, amount, idempotencyKey ?? null],
    );

    // Get updated balance
    const walletRes = await pool.query(
      `select balance from sponsor_wallets where sponsor_id = $1`,
      [sponsorId],
    );

    const evt = await appendEvent(
      'sponsor.credits_purchased',
      {
        sponsor_id: sponsorId,
        amount,
        new_balance: walletRes.rows[0].balance,
      },
      sponsorId,
      correlationId,
      idempotencyKey,
    );

    return { balance: walletRes.rows[0].balance, purchased: amount, event: evt };
  });

  reply.status(201);
  return result;
});

// Sponsor credits: Allocate to agent
app.post('/sponsor/:sponsorId/agents/:agentId/credits/allocate', async (request, reply) => {
  const { sponsorId, agentId } = request.params as { sponsorId: string; agentId: string };
  const body = request.body as { amount: number };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;

  const amount = Number(body.amount ?? 0);
  if (amount <= 0) {
    reply.status(400);
    return { error: 'amount must be positive' };
  }

  // Check agent exists and is sponsored by this sponsor
  const agentCheck = await pool.query(
    `select sponsor_id from agents where id = $1`,
    [agentId],
  );
  if (agentCheck.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }
  if (agentCheck.rows[0].sponsor_id !== sponsorId) {
    reply.status(403);
    return { error: 'agent not sponsored by this sponsor' };
  }

  // Check sponsor wallet balance
  const walletRes = await pool.query(
    `select balance from sponsor_wallets where sponsor_id = $1 for update`,
    [sponsorId],
  );
  if (walletRes.rowCount === 0 || walletRes.rows[0].balance < amount) {
    reply.status(400);
    return { error: 'sponsor_credit_insufficient', required: amount, available: walletRes.rows[0]?.balance ?? 0 };
  }

  const result = await withIdempotency(pool, idempotencyKey, async () => {
    // Deduct from sponsor wallet
    await pool.query(
      `update sponsor_wallets set balance = balance - $2, updated_at = now() where sponsor_id = $1`,
      [sponsorId, amount],
    );

    // Add to agent credit balance
    await pool.query(
      `insert into agent_credit_balance (agent_id, balance, updated_at)
       values ($1, $2, now())
       on conflict (agent_id)
       do update set balance = agent_credit_balance.balance + $2, updated_at = now()`,
      [agentId, amount],
    );

    // Record credit transaction
    await pool.query(
      `insert into credit_transactions (sponsor_id, agent_id, type, amount, idempotency_key)
       values ($1, $2, 'allocate_to_agent', $3, $4)`,
      [sponsorId, agentId, amount, idempotencyKey ?? null],
    );

    // Get updated balances
    const newWallet = await pool.query(
      `select balance from sponsor_wallets where sponsor_id = $1`,
      [sponsorId],
    );
    const newAgent = await pool.query(
      `select balance from agent_credit_balance where agent_id = $1`,
      [agentId],
    );

    const evt = await appendEvent(
      'agent.credits_allocated',
      {
        sponsor_id: sponsorId,
        agent_id: agentId,
        amount,
        sponsor_balance: newWallet.rows[0].balance,
        agent_balance: newAgent.rows[0].balance,
      },
      sponsorId,
      correlationId,
      idempotencyKey,
    );

    return {
      allocated: amount,
      sponsor_balance: newWallet.rows[0].balance,
      agent_balance: newAgent.rows[0].balance,
      event: evt,
    };
  });

  return result;
});

// Get sponsor wallet
app.get('/sponsor/:sponsorId/credits', async (request, _reply) => {
  const { sponsorId } = request.params as { sponsorId: string };

  const walletRes = await pool.query(
    `select balance, updated_at from sponsor_wallets where sponsor_id = $1`,
    [sponsorId],
  );

  if (walletRes.rowCount === 0) {
    return { balance: 0, updated_at: null };
  }

  const transactionsRes = await pool.query(
    `select * from credit_transactions where sponsor_id = $1 order by ts desc limit 20`,
    [sponsorId],
  );

  return {
    balance: walletRes.rows[0].balance,
    updated_at: walletRes.rows[0].updated_at,
    recent_transactions: transactionsRes.rows,
  };
});

// Get agent credit balance
app.get('/agents/:id/credits', async (request, _reply) => {
  const { id } = request.params as { id: string };

  const balanceRes = await pool.query(
    `select balance, updated_at from agent_credit_balance where agent_id = $1`,
    [id],
  );

  const transactionsRes = await pool.query(
    `select * from credit_transactions where agent_id = $1 order by ts desc limit 20`,
    [id],
  );

  return {
    balance: balanceRes.rows[0]?.balance ?? 0,
    updated_at: balanceRes.rows[0]?.updated_at ?? null,
    recent_transactions: transactionsRes.rows,
  };
});

// ============================================================================
// PHASE 10: Foundry (Agent Builder) v1
// ============================================================================

interface FoundryCreateBody {
  handle?: string;
  deployment_target?: string;
  sponsor_id?: string;
  config?: {
    cognition_provider?: string;
    throttle_profile?: string;
    bias?: Record<string, number>;
    initial_capacity?: number;
    max_capacity?: number;
  };
}

interface FoundryConfigUpdateBody {
  cognition_provider?: string;
  throttle_profile?: string;
  bias?: Record<string, number>;
}

// Validate bias values are within bounds
const validateBias = (bias: Record<string, number>): { valid: boolean; error?: string } => {
  for (const [key, value] of Object.entries(bias)) {
    if (typeof value !== 'number' || value < -1 || value > 1) {
      return { valid: false, error: `bias.${key} must be a number between -1 and 1` };
    }
  }
  return { valid: true };
};

// Foundry: Create agent with full config
app.post('/foundry/agents', async (request, reply) => {
  const body = request.body as FoundryCreateBody;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;

  // Validate cognition_provider if provided
  if (body.config?.cognition_provider) {
    const provider = body.config.cognition_provider.toLowerCase().trim();
    if (!COGNITION_PROVIDERS.includes(provider as CognitionProvider)) {
      reply.status(400);
      return { error: 'invalid cognition_provider', valid_providers: COGNITION_PROVIDERS };
    }
  }

  // Validate throttle_profile if provided
  if (body.config?.throttle_profile) {
    const profile = body.config.throttle_profile.toLowerCase().trim();
    if (!THROTTLE_PROFILES.includes(profile as ThrottleProfile)) {
      reply.status(400);
      return { error: 'invalid throttle_profile', valid_profiles: THROTTLE_PROFILES };
    }
  }

  // Validate bias if provided
  if (body.config?.bias) {
    const biasValidation = validateBias(body.config.bias);
    if (!biasValidation.valid) {
      reply.status(400);
      return { error: biasValidation.error };
    }
  }

  const result = await withIdempotency(pool, idempotencyKey, async () => {
    // Create agent
    const agentRes = await pool.query(
      `insert into agents (handle, deployment_target, sponsor_id, cognition_provider, throttle_profile)
       values ($1, $2, $3, $4::cognition_provider, $5::throttle_profile)
       returning *`,
      [
        body.handle ?? null,
        body.deployment_target ?? null,
        body.sponsor_id ?? null,
        body.config?.cognition_provider ?? 'none',
        body.config?.throttle_profile ?? 'normal',
      ],
    );
    const agent = agentRes.rows[0];

    // Initialize capacity
    const initialCapacity = body.config?.initial_capacity ?? 100;
    const maxCapacity = body.config?.max_capacity ?? 100;
    await pool.query(
      `insert into agent_capacity (agent_id, balance, max_balance) values ($1, $2, $3)`,
      [agent.id, initialCapacity, maxCapacity],
    );

    // Initialize config with bias and portable_config
    const bias = body.config?.bias ?? {};
    await pool.query(
      `insert into agent_config (agent_id, bias, foundry_version, portable_config)
       values ($1, $2, 1, $3)`,
      [agent.id, JSON.stringify(bias), JSON.stringify({
        cognition_provider: body.config?.cognition_provider ?? 'none',
        throttle_profile: body.config?.throttle_profile ?? 'normal',
        bias,
      })],
    );

    // Initialize credit balance
    await pool.query(
      `insert into agent_credit_balance (agent_id, balance) values ($1, 0)`,
      [agent.id],
    );

    const evt = await appendEvent(
      'agent.foundry_created',
      {
        agent_id: agent.id,
        handle: agent.handle,
        deployment_target: agent.deployment_target,
        sponsor_id: agent.sponsor_id,
        config: {
          cognition_provider: agent.cognition_provider,
          throttle_profile: agent.throttle_profile,
          bias,
        },
      },
      agent.id,
      correlationId,
      idempotencyKey,
    );

    return { agent, event: evt };
  });

  reply.status(201);
  return result;
});

// Foundry: Update agent config
app.put('/foundry/agents/:id/config', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as FoundryConfigUpdateBody;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Check agent exists
  const agentCheck = await pool.query(`select * from agents where id = $1`, [id]);
  if (agentCheck.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }

  const updates: string[] = [];
  const agentUpdates: string[] = [];
  const configUpdates: Record<string, unknown> = {};

  // Validate and collect updates
  if (body.cognition_provider !== undefined) {
    const provider = body.cognition_provider.toLowerCase().trim();
    if (!COGNITION_PROVIDERS.includes(provider as CognitionProvider)) {
      reply.status(400);
      return { error: 'invalid cognition_provider', valid_providers: COGNITION_PROVIDERS };
    }
    agentUpdates.push(`cognition_provider = '${provider}'::cognition_provider`);
    configUpdates.cognition_provider = provider;
  }

  if (body.throttle_profile !== undefined) {
    const profile = body.throttle_profile.toLowerCase().trim();
    if (!THROTTLE_PROFILES.includes(profile as ThrottleProfile)) {
      reply.status(400);
      return { error: 'invalid throttle_profile', valid_profiles: THROTTLE_PROFILES };
    }
    agentUpdates.push(`throttle_profile = '${profile}'::throttle_profile`);
    configUpdates.throttle_profile = profile;
  }

  if (body.bias !== undefined) {
    const biasValidation = validateBias(body.bias);
    if (!biasValidation.valid) {
      reply.status(400);
      return { error: biasValidation.error };
    }
    updates.push(`bias = $2`);
    configUpdates.bias = body.bias;
  }

  // Update agents table if needed
  if (agentUpdates.length > 0) {
    agentUpdates.push('updated_at = now()');
    await pool.query(
      `update agents set ${agentUpdates.join(', ')} where id = $1`,
      [id],
    );
  }

  // Update agent_config
  if (Object.keys(configUpdates).length > 0) {
    // Get current config
    const configRes = await pool.query(
      `select portable_config, version from agent_config where agent_id = $1`,
      [id],
    );
    const currentConfig = configRes.rows[0]?.portable_config ?? {};
    const newVersion = (configRes.rows[0]?.version ?? 0) + 1;

    const newPortableConfig = { ...currentConfig, ...configUpdates };

    await pool.query(
      `update agent_config set
         portable_config = $2,
         version = $3,
         ${body.bias ? 'bias = $4,' : ''}
         updated_at = now()
       where agent_id = $1`,
      body.bias
        ? [id, JSON.stringify(newPortableConfig), newVersion, JSON.stringify(body.bias)]
        : [id, JSON.stringify(newPortableConfig), newVersion],
    );
  }

  // Emit config updated event
  const evt = await appendEvent(
    'agent.config_updated',
    {
      agent_id: id,
      changes: configUpdates,
    },
    id,
    correlationId,
  );

  // Get updated agent
  const updatedRes = await pool.query(
    `select a.*, c.bias, c.portable_config, c.version as config_version
     from agents a
     left join agent_config c on c.agent_id = a.id
     where a.id = $1`,
    [id],
  );

  return { agent: updatedRes.rows[0], event: evt };
});

// Foundry: Deploy agent
app.post('/foundry/agents/:id/deploy', async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { deployment_target?: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Check agent exists
  const agentCheck = await pool.query(`select * from agents where id = $1`, [id]);
  if (agentCheck.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }

  const previousTarget = agentCheck.rows[0].deployment_target;
  const newTarget = body.deployment_target ?? previousTarget;

  // Check environment allows deployment
  if (newTarget) {
    const envRes = await pool.query(
      `select cognition_availability from environment_states where deployment_target = $1`,
      [newTarget],
    );
    if (envRes.rowCount && envRes.rowCount > 0 && envRes.rows[0].cognition_availability === 'unavailable') {
      reply.status(400);
      return { error: 'target_environment_unavailable', deployment_target: newTarget };
    }
  }

  // Update agent
  await pool.query(
    `update agents set deployment_target = $2, status = 'active', updated_at = now() where id = $1`,
    [id, newTarget],
  );

  const evt = await appendEvent(
    'agent.deployed',
    {
      agent_id: id,
      previous_deployment_target: previousTarget,
      new_deployment_target: newTarget,
    },
    id,
    correlationId,
  );

  const updatedRes = await pool.query(`select * from agents where id = $1`, [id]);

  return { agent: updatedRes.rows[0], event: evt };
});

// Foundry: Get agent with full config
app.get('/foundry/agents/:id', async (request, reply) => {
  const { id } = request.params as { id: string };

  const res = await pool.query(
    `select a.*,
            c.bias, c.portable_config, c.version as config_version, c.foundry_version,
            cap.balance as capacity_balance, cap.max_balance as capacity_max,
            cb.balance as credit_balance
     from agents a
     left join agent_config c on c.agent_id = a.id
     left join agent_capacity cap on cap.agent_id = a.id
     left join agent_credit_balance cb on cb.agent_id = a.id
     where a.id = $1`,
    [id],
  );

  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'agent not found' };
  }

  const row = res.rows[0];
  return {
    agent: {
      id: row.id,
      handle: row.handle,
      status: row.status,
      deployment_target: row.deployment_target,
      sponsor_id: row.sponsor_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    config: {
      cognition_provider: row.cognition_provider,
      throttle_profile: row.throttle_profile,
      bias: row.bias,
      portable_config: row.portable_config,
      version: row.config_version,
      foundry_version: row.foundry_version,
    },
    capacity: {
      balance: row.capacity_balance,
      max_balance: row.capacity_max,
    },
    credits: {
      balance: row.credit_balance ?? 0,
    },
  };
});

// Foundry: List agents endpoint
app.get('/foundry/agents', async (request) => {
  const query = request.query as { sponsor_id?: string; status?: string; limit?: string };
  const limit = Number(query.limit ?? 50);

  let whereClause = '';
  const params: unknown[] = [limit];

  if (query.sponsor_id) {
    whereClause += ' and a.sponsor_id = $2';
    params.push(query.sponsor_id);
  }
  if (query.status) {
    whereClause += ` and a.status = $${params.length + 1}::agent_status`;
    params.push(query.status);
  }

  const res = await pool.query(
    `select a.id, a.handle, a.status, a.deployment_target, a.sponsor_id,
            a.cognition_provider, a.throttle_profile, a.created_at
     from agents a
     where 1=1 ${whereClause}
     order by a.created_at desc
     limit $1`,
    params,
  );

  return { agents: res.rows };
});

// ============================================================================
// PHASE 11: Sponsor Braids & Pressure Composition
// Multiple sponsors influence the same agent/deployment through pressures.
// This is curling, not puppeteering.
// ============================================================================

const PRESSURE_TYPES = ['capacity', 'throttle', 'cognition', 'redeploy_bias'] as const;
type PressureType = (typeof PRESSURE_TYPES)[number];

// Credit cost formula: 10 credits * abs(magnitude)
const PRESSURE_CREDIT_COST_PER_MAGNITUDE = 10;

// Expiration: 10 half-lives (~0.1% remaining)
const PRESSURE_HALF_LIFE_MULTIPLIER = 10;

/**
 * Compute decayed magnitude using exponential half-life decay.
 * decayedMagnitude = magnitude * Math.pow(0.5, elapsedSeconds / halfLifeSeconds)
 */
function computeDecayedMagnitude(
  magnitude: number,
  halfLifeSeconds: number,
  elapsedSeconds: number,
): number {
  return magnitude * Math.pow(0.5, elapsedSeconds / halfLifeSeconds);
}

// Issue a new pressure (consumes credits)
app.post('/sponsor/:sponsorId/pressures', async (request, reply) => {
  const { sponsorId } = request.params as { sponsorId: string };
  const body = request.body as {
    target_deployment: string;
    target_agent_id?: string;
    pressure_type: string;
    magnitude: number;
    half_life_seconds: number;
  };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Validate pressure type
  const pressureType = body.pressure_type as PressureType;
  if (!PRESSURE_TYPES.includes(pressureType)) {
    reply.status(400);
    return { error: 'invalid pressure_type', valid_types: PRESSURE_TYPES };
  }

  // Validate magnitude
  if (typeof body.magnitude !== 'number' || body.magnitude < -100 || body.magnitude > 100) {
    reply.status(400);
    return { error: 'magnitude must be a number between -100 and 100' };
  }

  // Validate half_life_seconds
  if (typeof body.half_life_seconds !== 'number' || body.half_life_seconds < 60) {
    reply.status(400);
    return { error: 'half_life_seconds must be at least 60 seconds' };
  }

  // Validate target_deployment
  if (!body.target_deployment) {
    reply.status(400);
    return { error: 'target_deployment is required' };
  }

  // Calculate credit cost
  const creditCost = Math.ceil(Math.abs(body.magnitude) * PRESSURE_CREDIT_COST_PER_MAGNITUDE);

  // Check sponsor wallet balance
  const walletRes = await pool.query(
    `select balance from sponsor_wallets where sponsor_id = $1 for update`,
    [sponsorId],
  );

  if (walletRes.rowCount === 0 || walletRes.rows[0].balance < creditCost) {
    reply.status(400);
    return {
      error: 'insufficient_credits',
      required: creditCost,
      available: walletRes.rows[0]?.balance ?? 0,
    };
  }

  // Deduct credits from sponsor wallet
  await pool.query(
    `update sponsor_wallets set balance = balance - $2, updated_at = now() where sponsor_id = $1`,
    [sponsorId, creditCost],
  );

  // Calculate expiration (10 half-lives)
  const expiresAt = new Date(
    Date.now() + body.half_life_seconds * 1000 * PRESSURE_HALF_LIFE_MULTIPLIER,
  );

  // Create pressure
  const pressureRes = await pool.query(
    `insert into sponsor_pressures (
       sponsor_id, target_deployment, target_agent_id, pressure_type,
       magnitude, half_life_seconds, expires_at, credit_cost
     ) values ($1, $2, $3, $4::sponsor_pressure_type, $5, $6, $7, $8)
     returning *`,
    [
      sponsorId,
      body.target_deployment,
      body.target_agent_id ?? null,
      pressureType,
      body.magnitude,
      body.half_life_seconds,
      expiresAt,
      creditCost,
    ],
  );

  const pressure = pressureRes.rows[0];

  // Log credit consumption
  await pool.query(
    `insert into pressure_credit_consumption (pressure_id, sponsor_id, amount, reason)
     values ($1, $2, $3, $4)`,
    [pressure.id, sponsorId, creditCost, 'pressure_issued'],
  );

  // Emit event
  const evt = await appendEvent(
    'sponsor.pressure_issued',
    {
      pressure_id: pressure.id,
      sponsor_id: sponsorId,
      target_deployment: body.target_deployment,
      target_agent_id: body.target_agent_id ?? null,
      pressure_type: pressureType,
      magnitude: body.magnitude,
      half_life_seconds: body.half_life_seconds,
      expires_at: expiresAt.toISOString(),
      credit_cost: creditCost,
    },
    sponsorId,
    correlationId,
  );

  reply.status(201);
  return { pressure, event: evt };
});

// List active pressures for a sponsor
app.get('/sponsor/:sponsorId/pressures', async (request) => {
  const { sponsorId } = request.params as { sponsorId: string };
  const query = request.query as { include_expired?: string; limit?: string };
  const includeExpired = query.include_expired === 'true';
  const limit = Number(query.limit ?? 50);

  const now = new Date();

  let sql = `
    select id, sponsor_id, target_deployment, target_agent_id, pressure_type,
           magnitude, half_life_seconds, created_at, expires_at, cancelled_at, credit_cost
    from sponsor_pressures
    where sponsor_id = $1
  `;
  const params: unknown[] = [sponsorId];

  if (!includeExpired) {
    sql += ` and expires_at > $2 and cancelled_at is null`;
    params.push(now);
  }

  sql += ` order by created_at desc limit $${params.length + 1}`;
  params.push(limit);

  const res = await pool.query(sql, params);

  // Compute current decayed magnitude for each active pressure
  const pressures = res.rows.map((p) => {
    const elapsedSeconds = (now.getTime() - new Date(p.created_at).getTime()) / 1000;
    const currentMagnitude = computeDecayedMagnitude(
      p.magnitude,
      p.half_life_seconds,
      elapsedSeconds,
    );
    return {
      ...p,
      current_magnitude: Math.round(currentMagnitude * 1000) / 1000,
      decay_pct: Math.round((1 - currentMagnitude / p.magnitude) * 100 * 10) / 10,
    };
  });

  return { pressures };
});

// Cancel a pressure (decay continues, no refund)
app.post('/sponsor/:sponsorId/pressures/:pressureId/cancel', async (request, reply) => {
  const { sponsorId, pressureId } = request.params as { sponsorId: string; pressureId: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Check pressure exists and belongs to sponsor
  const pressureRes = await pool.query(
    `select * from sponsor_pressures where id = $1 and sponsor_id = $2`,
    [pressureId, sponsorId],
  );

  if (pressureRes.rowCount === 0) {
    reply.status(404);
    return { error: 'pressure not found' };
  }

  const pressure = pressureRes.rows[0];

  if (pressure.cancelled_at) {
    return { ok: true, message: 'already cancelled', pressure };
  }

  // Mark as cancelled
  await pool.query(
    `update sponsor_pressures set cancelled_at = now() where id = $1`,
    [pressureId],
  );

  // Log pressure event
  await pool.query(
    `insert into sponsor_pressure_events (pressure_id, event_type, details_json)
     values ($1, 'cancelled', $2)`,
    [pressureId, JSON.stringify({ cancelled_by: sponsorId })],
  );

  // Emit event
  const evt = await appendEvent(
    'sponsor.pressure_cancelled',
    {
      pressure_id: pressureId,
      sponsor_id: sponsorId,
      target_deployment: pressure.target_deployment,
      pressure_type: pressure.pressure_type,
    },
    sponsorId,
    correlationId,
  );

  return { ok: true, event: evt };
});

// Get a specific pressure
app.get('/sponsor/:sponsorId/pressures/:pressureId', async (request, reply) => {
  const { sponsorId, pressureId } = request.params as { sponsorId: string; pressureId: string };

  const res = await pool.query(
    `select * from sponsor_pressures where id = $1 and sponsor_id = $2`,
    [pressureId, sponsorId],
  );

  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'pressure not found' };
  }

  const pressure = res.rows[0];
  const now = new Date();
  const elapsedSeconds = (now.getTime() - new Date(pressure.created_at).getTime()) / 1000;
  const currentMagnitude = computeDecayedMagnitude(
    pressure.magnitude,
    pressure.half_life_seconds,
    elapsedSeconds,
  );

  return {
    pressure: {
      ...pressure,
      current_magnitude: Math.round(currentMagnitude * 1000) / 1000,
      decay_pct: Math.round((1 - currentMagnitude / pressure.magnitude) * 100 * 10) / 10,
    },
  };
});

// Get all active pressures for a deployment (admin/physics endpoint)
app.get('/admin/deployments/:target/pressures', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const { target } = request.params as { target: string };
  const now = new Date();

  const res = await pool.query(
    `select * from sponsor_pressures
     where target_deployment = $1
       and expires_at > $2
       and cancelled_at is null
     order by created_at desc`,
    [target, now],
  );

  // Compute decayed magnitudes
  const pressures = res.rows.map((p) => {
    const elapsedSeconds = (now.getTime() - new Date(p.created_at).getTime()) / 1000;
    const currentMagnitude = computeDecayedMagnitude(
      p.magnitude,
      p.half_life_seconds,
      elapsedSeconds,
    );
    return {
      ...p,
      current_magnitude: Math.round(currentMagnitude * 1000) / 1000,
    };
  });

  return { deployment_target: target, pressures };
});

// ============================================================================
// PHASE 12: Locality Fields, Encounter Density & Collision Mechanics
// Locality is not a room you join. Locality is a field that shapes encounter probability.
// ============================================================================

interface LocalityParams {
  density: number;
  cluster_bias: number;
  interference_density: number;
  visibility_radius: number;
  evidence_half_life: number;
}

const DEFAULT_LOCALITY_PARAMS: LocalityParams = {
  density: 1.0,
  cluster_bias: 0.5,
  interference_density: 0.3,
  visibility_radius: 1.0,
  evidence_half_life: 300,
};

// Create a locality (admin only)
app.post('/admin/localities/:target', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const { target } = request.params as { target: string };
  const body = request.body as { name: string; params?: Partial<LocalityParams> };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  if (!body.name) {
    reply.status(400);
    return { error: 'name is required' };
  }

  const params: LocalityParams = {
    ...DEFAULT_LOCALITY_PARAMS,
    ...body.params,
  };

  // Validate params
  if (params.density < 0 || params.density > 10) {
    reply.status(400);
    return { error: 'density must be between 0 and 10' };
  }

  try {
    const res = await pool.query(
      `insert into ox_localities (deployment_target, name, params_json)
       values ($1, $2, $3)
       returning *`,
      [target, body.name, JSON.stringify(params)],
    );

    const locality = res.rows[0];

    await appendEvent(
      'ox.locality.created',
      {
        locality_id: locality.id,
        deployment_target: target,
        name: body.name,
        params,
      },
      'admin',
      correlationId,
    );

    reply.status(201);
    return { locality };
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      reply.status(409);
      return { error: 'locality with this name already exists' };
    }
    throw err;
  }
});

// List localities for a deployment
app.get('/admin/localities/:target', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const { target } = request.params as { target: string };
  const query = request.query as { include_inactive?: string };
  const includeInactive = query.include_inactive === 'true';

  let sql = `select * from ox_localities where deployment_target = $1`;
  if (!includeInactive) {
    sql += ` and active = true`;
  }
  sql += ` order by created_at desc`;

  const res = await pool.query(sql, [target]);

  return { deployment_target: target, localities: res.rows };
});

// Update a locality
app.put('/admin/localities/:target/:localityId', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const { target, localityId } = request.params as { target: string; localityId: string };
  const body = request.body as { params?: Partial<LocalityParams> };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  const existing = await pool.query(
    `select * from ox_localities where id = $1 and deployment_target = $2`,
    [localityId, target],
  );

  if (existing.rowCount === 0) {
    reply.status(404);
    return { error: 'locality not found' };
  }

  const currentParams = existing.rows[0].params_json as LocalityParams;
  const newParams: LocalityParams = {
    ...currentParams,
    ...body.params,
  };

  await pool.query(
    `update ox_localities set params_json = $2 where id = $1`,
    [localityId, JSON.stringify(newParams)],
  );

  await appendEvent(
    'ox.locality.updated',
    {
      locality_id: localityId,
      deployment_target: target,
      previous_params: currentParams,
      new_params: newParams,
    },
    'admin',
    correlationId,
  );

  return { ok: true, locality_id: localityId, params: newParams };
});

// Deactivate a locality (soft delete)
app.delete('/admin/localities/:target/:localityId', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const { target, localityId } = request.params as { target: string; localityId: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  const res = await pool.query(
    `update ox_localities set active = false where id = $1 and deployment_target = $2 returning *`,
    [localityId, target],
  );

  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'locality not found' };
  }

  await appendEvent(
    'ox.locality.deactivated',
    {
      locality_id: localityId,
      deployment_target: target,
    },
    'admin',
    correlationId,
  );

  return { ok: true };
});

// Get active localities for physics (internal endpoint)
app.get('/internal/localities/:target', async (request) => {
  const { target } = request.params as { target: string };

  const res = await pool.query(
    `select l.*, array_agg(m.agent_id) filter (where m.agent_id is not null) as member_agent_ids
     from ox_localities l
     left join ox_locality_memberships m on m.locality_id = l.id
     where l.deployment_target = $1 and l.active = true
     group by l.id`,
    [target],
  );

  return { localities: res.rows };
});

// Get locality memberships for collision generation (internal endpoint for physics)
app.get('/internal/locality-memberships/:target', async (request) => {
  const { target } = request.params as { target: string };

  const res = await pool.query(
    `select m.locality_id, l.name as locality_name, m.agent_id, m.weight, l.interference_density
     from ox_locality_memberships m
     join ox_localities l on l.id = m.locality_id
     where l.deployment_target = $1 and l.active = true`,
    [target],
  );

  return { memberships: res.rows };
});

// Assign membership to localities (called on agent create/redeploy)
async function assignLocalityMembership(
  agentId: string,
  deploymentTarget: string,
  correlationId?: string,
): Promise<void> {
  // Get active localities for this deployment
  const localities = await pool.query(
    `select id, params_json from ox_localities
     where deployment_target = $1 and active = true`,
    [deploymentTarget],
  );

  if (localities.rowCount === 0) {
    return;
  }

  // Clear existing memberships
  await pool.query(
    `delete from ox_locality_memberships where agent_id = $1`,
    [agentId],
  );

  // Seeded RNG based on agent_id + deployment_target for reproducibility
  const seed = agentId + deploymentTarget;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }
  const rng = () => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    return hash / 0x7fffffff;
  };

  // Select up to 2 localities with random weights
  const maxLocalities = Math.min(2, localities.rowCount ?? 0);
  const shuffled = [...localities.rows].sort(() => rng() - 0.5);
  const selected = shuffled.slice(0, maxLocalities);

  // Generate weights and normalize
  const weights = selected.map(() => rng());
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const normalizedWeights = weights.map(w => w / totalWeight);

  // Insert memberships
  for (let i = 0; i < selected.length; i++) {
    await pool.query(
      `insert into ox_locality_memberships (agent_id, locality_id, weight)
       values ($1, $2, $3)
       on conflict (agent_id, locality_id) do update set weight = $3, assigned_at = now()`,
      [agentId, selected[i].id, normalizedWeights[i]],
    );
  }

  // Emit event
  await appendEvent(
    'ox.locality.membership_assigned',
    {
      agent_id: agentId,
      deployment_target: deploymentTarget,
      memberships: selected.map((l, i) => ({
        locality_id: l.id,
        weight: normalizedWeights[i],
      })),
    },
    agentId,
    correlationId,
  );
}

// Get collision context for an agent (for action attempts)
app.get('/internal/agents/:id/collision-context', async (request) => {
  const { id } = request.params as { id: string };
  const now = new Date();

  const res = await pool.query(
    `select * from ox_collision_context
     where agent_id = $1 and expires_at > $2
     order by expires_at desc
     limit 1`,
    [id, now],
  );

  if (res.rowCount === 0) {
    return { context: null };
  }

  return { context: res.rows[0] };
});

// Store collision context (called by physics after generating collisions)
app.post('/internal/collisions', async (request) => {
  const body = request.body as {
    deployment_target: string;
    locality_id: string;
    agent_ids: string[];
    reason_json: Record<string, unknown>;
    source_tick_id: string;
  };

  // Insert collision event
  const collisionRes = await pool.query(
    `insert into ox_collision_events (deployment_target, locality_id, agent_ids, reason_json, source_tick_id)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [body.deployment_target, body.locality_id, body.agent_ids, JSON.stringify(body.reason_json), body.source_tick_id],
  );

  const collision = collisionRes.rows[0];
  const expiresAt = new Date(Date.now() + 120 * 1000); // 2 minute TTL

  // Create collision context for each agent
  for (const agentId of body.agent_ids) {
    const peerIds = body.agent_ids.filter(id => id !== agentId);
    await pool.query(
      `insert into ox_collision_context (agent_id, collision_id, locality_id, peer_ids, expires_at)
       values ($1, $2, $3, $4, $5)
       on conflict (agent_id, collision_id) do nothing`,
      [agentId, collision.id, body.locality_id, peerIds, expiresAt],
    );
  }

  return { collision };
});

// ============================================================================
// PHASE 13-19: Internal Analytics Endpoints (for physics service)
// ============================================================================

// Get recent interactions for a deployment (Phase 13)
app.get('/internal/interactions/:target', async (request) => {
  const { target } = request.params as { target: string };
  const query = request.query as { since?: string };
  const since = query.since ? new Date(query.since) : new Date(Date.now() - 5 * 60 * 1000);

  const res = await pool.query(
    `select e.agent_id, e.payload_json->>'target_agent_id' as target_agent_id,
            e.payload_json->>'action_type' as action_type, e.ts
     from events e
     where e.payload_json->>'deployment_target' = $1
       and e.ts > $2
       and e.event_type like 'agent.action_%'
       and e.payload_json->>'accepted' = 'true'
     order by e.ts desc
     limit 1000`,
    [target, since],
  );

  // Convert to interaction format
  const interactions = res.rows.map((row) => ({
    agent_id: row.agent_id,
    partner_ids: row.target_agent_id ? [row.target_agent_id] : [],
    action_type: row.action_type,
    ts: row.ts,
  }));

  return { interactions };
});

// Get recent conflict actions for a deployment (Phase 14)
app.get('/internal/conflict-actions/:target', async (request) => {
  const { target } = request.params as { target: string };
  const query = request.query as { since?: string };
  const since = query.since ? new Date(query.since) : new Date(Date.now() - 10 * 60 * 1000);

  const res = await pool.query(
    `select e.agent_id, e.payload_json->>'target_agent_id' as target_agent_id,
            e.payload_json->>'action_type' as action_type, e.ts
     from events e
     where e.payload_json->>'deployment_target' = $1
       and e.ts > $2
       and e.event_type like 'agent.action_%'
       and e.payload_json->>'accepted' = 'true'
       and e.payload_json->>'action_type' in ('conflict', 'counter_model', 'refusal', 'critique')
     order by e.ts desc
     limit 500`,
    [target, since],
  );

  const conflicts = res.rows.map((row) => ({
    agent_id: row.agent_id,
    target_agent_id: row.target_agent_id,
    action_type: row.action_type,
    ts: row.ts,
  }));

  return { conflicts };
});

// Get agent activity status for a deployment (Phase 16)
app.get('/internal/agent-activity/:target', async (request) => {
  const { target } = request.params as { target: string };

  const res = await pool.query(
    `select a.id as agent_id,
            max(e.ts) as last_action_at,
            count(e.id) filter (where e.ts > now() - interval '24 hours') as total_actions_24h,
            count(e.id) filter (where e.ts > now() - interval '1 hour')::float as avg_actions_per_hour
     from agents a
     left join events e on e.agent_id = a.id and e.event_type like 'agent.action_%'
     where a.deployment_target = $1 and a.status = 'active'
     group by a.id`,
    [target],
  );

  return { agents: res.rows };
});

// Get action bursts for a deployment (Phase 17)
app.get('/internal/action-bursts/:target', async (request) => {
  const { target } = request.params as { target: string };

  const res = await pool.query(
    `with recent_actions as (
       select payload_json->>'action_type' as action_type,
              agent_id,
              ts,
              ts > now() - interval '1 minute' as in_last_minute
       from events
       where payload_json->>'deployment_target' = $1
         and event_type like 'agent.action_%'
         and payload_json->>'accepted' = 'true'
         and ts > now() - interval '5 minutes'
     )
     select action_type,
            array_agg(distinct agent_id) as agent_ids,
            count(*) filter (where in_last_minute) as count_last_minute,
            count(*) as count_last_5_minutes
     from recent_actions
     group by action_type
     having count(*) filter (where in_last_minute) > 0`,
    [target],
  );

  return { bursts: res.rows };
});

// Get interaction graph for a deployment (Phase 19)
app.get('/internal/interaction-graph/:target', async (request) => {
  const { target } = request.params as { target: string };

  // Get all active agents
  const agentsRes = await pool.query(
    `select id from agents where deployment_target = $1 and status = 'active'`,
    [target],
  );
  const nodes = agentsRes.rows.map((r) => r.id);

  // Get interaction edges (last 24 hours)
  const edgesRes = await pool.query(
    `select e.agent_id as from_id,
            e.payload_json->>'target_agent_id' as to_id,
            e.payload_json->>'action_type' as type,
            count(*) as weight
     from events e
     where e.payload_json->>'deployment_target' = $1
       and e.event_type like 'agent.action_%'
       and e.payload_json->>'accepted' = 'true'
       and e.payload_json->>'target_agent_id' is not null
       and e.ts > now() - interval '24 hours'
     group by e.agent_id, e.payload_json->>'target_agent_id', e.payload_json->>'action_type'`,
    [target],
  );

  const edges = edgesRes.rows.map((r) => ({
    from: r.from_id,
    to: r.to_id,
    weight: parseInt(r.weight, 10),
    type: r.type,
  }));

  return { nodes, edges };
});

// ============================================================================
// PHASE 20: World Forks, Resets & Continuity Archaeology
// ============================================================================

// Fork a world
app.post('/admin/worlds/:target/fork', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const { target } = request.params as { target: string };
  const body = request.body as { from_world_id: string; reason?: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  if (!body.from_world_id) {
    reply.status(400);
    return { error: 'from_world_id is required' };
  }

  // Check parent world exists
  const parent = await pool.query(
    `select * from ox_worlds where id = $1`,
    [body.from_world_id],
  );

  if (parent.rowCount === 0) {
    reply.status(404);
    return { error: 'parent world not found' };
  }

  // Create new world
  const worldRes = await pool.query(
    `insert into ox_worlds (deployment_target, parent_world_id, fork_reason_json)
     values ($1, $2, $3)
     returning *`,
    [target, body.from_world_id, JSON.stringify({ reason: body.reason ?? 'fork' })],
  );

  const world = worldRes.rows[0];

  // Create epoch 0
  const epochRes = await pool.query(
    `insert into ox_world_epochs (world_id, epoch_index, reason_json)
     values ($1, 0, $2)
     returning *`,
    [world.id, JSON.stringify({ reason: 'fork_start' })],
  );

  const epoch = epochRes.rows[0];

  // End parent's current epoch if active
  await pool.query(
    `update ox_world_epochs set ended_at = now()
     where world_id = $1 and ended_at is null`,
    [body.from_world_id],
  );

  await appendEvent(
    'ox.world.forked',
    {
      world_id: world.id,
      parent_world_id: body.from_world_id,
      deployment_target: target,
      reason: body.reason,
    },
    'admin',
    correlationId,
  );

  await appendEvent(
    'ox.epoch.started',
    {
      world_id: world.id,
      epoch_id: epoch.id,
      epoch_index: 0,
    },
    'admin',
    correlationId,
  );

  reply.status(201);
  return { world, epoch };
});

// Reset a world (start new epoch)
app.post('/admin/worlds/:target/reset', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const { target } = request.params as { target: string };
  const body = request.body as { world_id?: string; reason?: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  let worldId = body.world_id;

  // If no world_id, get or create default world for target
  if (!worldId) {
    const existing = await pool.query(
      `select id from ox_worlds where deployment_target = $1 order by created_at desc limit 1`,
      [target],
    );

    if (existing.rowCount === 0) {
      // Create new world
      const newWorld = await pool.query(
        `insert into ox_worlds (deployment_target, fork_reason_json)
         values ($1, $2)
         returning *`,
        [target, JSON.stringify({ reason: 'initial' })],
      );
      worldId = newWorld.rows[0].id;

      await appendEvent(
        'ox.world.created',
        {
          world_id: worldId,
          deployment_target: target,
        },
        'admin',
        correlationId,
      );
    } else {
      worldId = existing.rows[0].id;
    }
  }

  // End current epoch
  const currentEpoch = await pool.query(
    `update ox_world_epochs set ended_at = now()
     where world_id = $1 and ended_at is null
     returning *`,
    [worldId],
  );

  if (currentEpoch.rowCount && currentEpoch.rowCount > 0) {
    await appendEvent(
      'ox.epoch.ended',
      {
        world_id: worldId,
        epoch_id: currentEpoch.rows[0].id,
        epoch_index: currentEpoch.rows[0].epoch_index,
      },
      'admin',
      correlationId,
    );
  }

  // Get next epoch index
  const maxEpoch = await pool.query(
    `select max(epoch_index) as max_idx from ox_world_epochs where world_id = $1`,
    [worldId],
  );
  const nextIndex = (maxEpoch.rows[0]?.max_idx ?? -1) + 1;

  // Create new epoch
  const epochRes = await pool.query(
    `insert into ox_world_epochs (world_id, epoch_index, reason_json)
     values ($1, $2, $3)
     returning *`,
    [worldId, nextIndex, JSON.stringify({ reason: body.reason ?? 'reset' })],
  );

  const epoch = epochRes.rows[0];

  await appendEvent(
    'ox.world.reset',
    {
      world_id: worldId,
      deployment_target: target,
      new_epoch_index: nextIndex,
      reason: body.reason,
    },
    'admin',
    correlationId,
  );

  await appendEvent(
    'ox.epoch.started',
    {
      world_id: worldId,
      epoch_id: epoch.id,
      epoch_index: nextIndex,
    },
    'admin',
    correlationId,
  );

  return { world_id: worldId, epoch };
});

// List worlds
app.get('/admin/worlds', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const query = request.query as { target?: string; limit?: string };
  const limit = Number(query.limit ?? 50);

  let sql = `select * from ox_worlds`;
  const params: unknown[] = [];

  if (query.target) {
    sql += ` where deployment_target = $1`;
    params.push(query.target);
  }

  sql += ` order by created_at desc limit $${params.length + 1}`;
  params.push(limit);

  const res = await pool.query(sql, params);

  return { worlds: res.rows };
});

// Get world epochs
app.get('/admin/worlds/:worldId/epochs', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const { worldId } = request.params as { worldId: string };

  const res = await pool.query(
    `select * from ox_world_epochs where world_id = $1 order by epoch_index desc`,
    [worldId],
  );

  return { world_id: worldId, epochs: res.rows };
});

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
