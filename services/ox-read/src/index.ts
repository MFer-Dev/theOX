import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ensureCorrelationId, getPool } from '@platform/shared';
import { runConsumer, EventEnvelope } from '@platform/events';

const pool = getPool('ox_read');

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
      title: 'OX Read Service',
      description: 'Read-only observational projection for OX Live',
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

// --- Consumer state ---

let consumerInitialized = false;

// --- Event type definitions ---

interface AgentEventPayload {
  agent_id: string;
  deployment_target?: string;
  action_type?: string;
  session_id?: string;
  handle?: string;
  requested_cost?: number;
  cost?: number;
  accepted?: boolean;
  reason?: string;
  remaining_balance?: number;
  amount?: number;
  new_balance?: number;
  [key: string]: unknown;
}

// --- Summary builders ---

const buildSummary = (eventType: string, payload: AgentEventPayload): Record<string, unknown> => {
  switch (eventType) {
    case 'agent.created':
      return {
        label: 'Agent created',
        handle: payload.handle ?? null,
        deployment_target: payload.deployment_target ?? null,
      };

    case 'agent.archived':
      return {
        label: 'Agent archived',
      };

    case 'agent.redeployed':
      return {
        label: 'Agent redeployed',
        deployment_target: payload.deployment_target ?? null,
      };

    case 'agent.capacity_allocated':
      return {
        label: 'Capacity allocated',
        amount: payload.amount ?? 0,
        new_balance: payload.new_balance ?? null,
      };

    case 'agent.action_accepted':
      return {
        label: `Agent ${payload.action_type ?? 'action'} accepted`,
        outcome: 'accepted',
        action_type: payload.action_type ?? null,
        cost: payload.requested_cost ?? payload.cost ?? 0,
        remaining_balance: payload.remaining_balance ?? null,
      };

    case 'agent.action_rejected':
      return {
        label: `Agent ${payload.action_type ?? 'action'} rejected`,
        outcome: 'rejected',
        action_type: payload.action_type ?? null,
        cost: payload.requested_cost ?? payload.cost ?? 0,
        reason: payload.reason ?? 'unknown',
      };

    default:
      return {
        label: eventType,
        raw_type: eventType,
      };
  }
};

// --- Event handler (idempotent) ---

const handleEvent = async (event: EventEnvelope<AgentEventPayload>): Promise<void> => {
  const payload = event.payload;
  const agentId = payload.agent_id;
  const deploymentTarget = payload.deployment_target ?? 'unknown';
  const actionType = payload.action_type ?? null;
  const sessionId = payload.session_id ?? null;

  const summary = buildSummary(event.event_type, payload);

  // Idempotent insert: ignore if source_event_id already exists
  try {
    await pool.query(
      `insert into ox_live_events (ts, type, agent_id, deployment_target, action_type, session_id, summary_json, source_event_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (source_event_id) do nothing`,
      [
        event.occurred_at,
        event.event_type,
        agentId,
        deploymentTarget,
        actionType,
        sessionId,
        JSON.stringify(summary),
        event.event_id,
      ],
    );
  } catch (err) {
    // Log but don't crash - allow consumer to continue
    app.log.error({ err, event_id: event.event_id }, 'Failed to materialize event');
    throw err; // Re-throw to trigger retry/DLQ
  }
};

// --- Start consumer ---

const startConsumer = async () => {
  try {
    await runConsumer({
      groupId: 'ox-read-materializer',
      topics: ['events.agents.v1'],
      handler: handleEvent,
      dlq: true,
    });
    consumerInitialized = true;
    app.log.info('OX Read consumer started for events.agents.v1');
  } catch (err) {
    app.log.error({ err }, 'Failed to start consumer');
    // Don't exit - service can still serve cached data
  }
};

// --- Health endpoints ---

app.get('/healthz', async () => ({ ok: true }));

app.get('/readyz', async () => {
  const checks: Record<string, boolean> = {};

  // 1. DB reachable
  try {
    await pool.query('select 1');
    checks.db = true;
  } catch {
    checks.db = false;
  }

  // 2. Consumer initialized
  checks.consumer = consumerInitialized;

  const ready = checks.db && checks.consumer;
  return { ready, checks };
});

// --- Read-only API ---

interface LiveQueryParams {
  limit?: string;
}

app.get('/ox/live', async (request) => {
  const query = request.query as LiveQueryParams;
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, ts, type, agent_id, deployment_target, action_type, session_id, summary_json as summary
     from ox_live_events
     order by ts desc
     limit $1`,
    [limit],
  );

  return {
    events: res.rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      type: row.type,
      agent_id: row.agent_id,
      deployment_target: row.deployment_target,
      action_type: row.action_type,
      session_id: row.session_id,
      summary: row.summary,
    })),
  };
});

// --- Start server ---

const start = async () => {
  const port = Number(process.env.PORT ?? 4018);

  // Start consumer in background (don't block server startup)
  startConsumer().catch((err) => {
    app.log.error({ err }, 'Consumer startup failed');
  });

  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`ox-read service running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start ox-read service');
  process.exit(1);
});
