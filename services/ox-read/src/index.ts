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
      version: '0.2.0',
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

// Session derivation parameters
const SESSION_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_INTERACTION_WINDOW_MS = 30 * 1000; // 30 seconds for multi-agent interaction
const ESCALATION_ACTION_TYPES = ['conflict', 'withdraw'];

// Pattern window size
const PATTERN_WINDOW_HOURS = 24;

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

// --- Session derivation logic ---

/**
 * Derive session topic heuristically from event types and action types.
 * This is intentionally simple and descriptive, not prescriptive.
 */
const deriveSessionTopic = (actionTypes: string[]): string | null => {
  if (actionTypes.length === 0) return null;

  const hasConflict = actionTypes.includes('conflict');
  const hasCommunicate = actionTypes.includes('communicate');
  const hasExchange = actionTypes.includes('exchange');
  const hasAssociate = actionTypes.includes('associate');
  const hasCreate = actionTypes.includes('create');

  if (hasConflict) return 'conflict_scene';
  if (hasExchange) return 'exchange_scene';
  if (hasAssociate) return 'association_scene';
  if (hasCommunicate && hasCreate) return 'collaborative_scene';
  if (hasCommunicate) return 'communication_scene';
  if (hasCreate) return 'creation_scene';

  return 'general_activity';
};

/**
 * Find or create a session for the given event.
 * Session rules:
 * - A session begins when two or more agents interact within a short window
 * - OR a single agent escalates actions (e.g., repeated conflict)
 * - A session ends when inactivity timeout is reached or terminal action occurs
 */
const findOrCreateSession = async (
  agentId: string,
  deploymentTarget: string,
  eventTs: Date,
  eventType: string,
  actionType: string | null,
): Promise<string | null> => {
  // Only create sessions for action events
  if (!eventType.startsWith('agent.action_')) {
    return null;
  }

  const eventTsMs = eventTs.getTime();

  // Look for active sessions in the same deployment target within the interaction window
  const activeSessionsRes = await pool.query(
    `select session_id, participating_agent_ids, start_ts, event_count
     from ox_sessions
     where deployment_target = $1
       and is_active = true
       and start_ts > $2::timestamptz - interval '${SESSION_INACTIVITY_TIMEOUT_MS} milliseconds'
     order by start_ts desc
     limit 5`,
    [deploymentTarget, eventTs],
  );

  // Check for recent activity from other agents (multi-agent interaction)
  const recentOtherAgentRes = await pool.query(
    `select distinct agent_id
     from ox_live_events
     where deployment_target = $1
       and agent_id != $2
       and ts > $3::timestamptz - interval '${SESSION_INTERACTION_WINDOW_MS} milliseconds'
       and type like 'agent.action_%'
     limit 5`,
    [deploymentTarget, agentId, eventTs],
  );

  const hasRecentOtherAgents = (recentOtherAgentRes.rowCount ?? 0) > 0;
  const isEscalation = actionType && ESCALATION_ACTION_TYPES.includes(actionType);

  // Find a matching active session
  for (const row of activeSessionsRes.rows) {
    const sessionAgents: string[] = row.participating_agent_ids || [];
    const sessionStartMs = new Date(row.start_ts).getTime();

    // Check if within inactivity timeout
    if (eventTsMs - sessionStartMs > SESSION_INACTIVITY_TIMEOUT_MS) {
      // Close this session
      await pool.query(
        `update ox_sessions set is_active = false, end_ts = $2 where session_id = $1`,
        [row.session_id, new Date(sessionStartMs + SESSION_INACTIVITY_TIMEOUT_MS)],
      );
      continue;
    }

    // If this agent is already in the session, or there's multi-agent interaction, join
    if (sessionAgents.includes(agentId) || hasRecentOtherAgents) {
      // Add agent if not present
      if (!sessionAgents.includes(agentId)) {
        await pool.query(
          `update ox_sessions
           set participating_agent_ids = array_append(participating_agent_ids, $2::uuid),
               event_count = event_count + 1
           where session_id = $1`,
          [row.session_id, agentId],
        );
      } else {
        await pool.query(
          `update ox_sessions set event_count = event_count + 1 where session_id = $1`,
          [row.session_id],
        );
      }
      return row.session_id;
    }
  }

  // Decide whether to create a new session
  // Criteria: multi-agent interaction OR escalation behavior
  const shouldCreateSession = hasRecentOtherAgents || isEscalation;

  if (!shouldCreateSession) {
    return null;
  }

  // Create new session
  const participatingAgents = [agentId];
  if (hasRecentOtherAgents) {
    for (const r of recentOtherAgentRes.rows) {
      if (!participatingAgents.includes(r.agent_id)) {
        participatingAgents.push(r.agent_id);
      }
    }
  }

  const newSessionRes = await pool.query(
    `insert into ox_sessions (start_ts, participating_agent_ids, deployment_target, event_count)
     values ($1, $2, $3, 1)
     returning session_id`,
    [eventTs, participatingAgents, deploymentTarget],
  );

  return newSessionRes.rows[0].session_id;
};

/**
 * Add event to session (if session exists).
 */
const addEventToSession = async (
  sessionId: string,
  sourceEventId: string,
  agentId: string,
  ts: Date,
  eventType: string,
  actionType: string | null,
  summary: Record<string, unknown>,
): Promise<void> => {
  await pool.query(
    `insert into ox_session_events (session_id, source_event_id, agent_id, ts, event_type, action_type, summary_json)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (source_event_id) do nothing`,
    [sessionId, sourceEventId, agentId, ts, eventType, actionType, JSON.stringify(summary)],
  );
};

/**
 * Update session topic heuristically after new event.
 */
const updateSessionTopic = async (sessionId: string): Promise<void> => {
  const res = await pool.query(
    `select array_agg(distinct action_type) filter (where action_type is not null) as action_types
     from ox_session_events
     where session_id = $1`,
    [sessionId],
  );

  const actionTypes: string[] = res.rows[0]?.action_types || [];
  const topic = deriveSessionTopic(actionTypes);

  if (topic) {
    await pool.query(
      `update ox_sessions set derived_topic = $2 where session_id = $1`,
      [sessionId, topic],
    );
  }
};

// --- Pattern derivation logic ---

/**
 * Update agent patterns after processing an event.
 * Patterns are descriptive observations, not scores or judgments.
 */
const updateAgentPatterns = async (
  agentId: string,
  eventTs: Date,
  eventType: string,
  _actionType: string | null,
): Promise<void> => {
  // Only track action patterns
  if (!eventType.startsWith('agent.action_')) {
    return;
  }

  const windowEnd = new Date(eventTs);
  const windowStart = new Date(windowEnd.getTime() - PATTERN_WINDOW_HOURS * 60 * 60 * 1000);

  // Compute action frequency pattern
  const freqRes = await pool.query(
    `select
       action_type,
       count(*) as count,
       count(*) filter (where type = 'agent.action_accepted') as accepted_count,
       count(*) filter (where type = 'agent.action_rejected') as rejected_count
     from ox_live_events
     where agent_id = $1
       and ts >= $2
       and ts <= $3
       and type like 'agent.action_%'
     group by action_type`,
    [agentId, windowStart, windowEnd],
  );

  if (freqRes.rowCount === 0) {
    return;
  }

  const actionFrequency: Record<string, { total: number; accepted: number; rejected: number }> = {};
  let totalActions = 0;

  for (const row of freqRes.rows) {
    if (row.action_type) {
      actionFrequency[row.action_type] = {
        total: Number(row.count),
        accepted: Number(row.accepted_count),
        rejected: Number(row.rejected_count),
      };
      totalActions += Number(row.count);
    }
  }

  // Compute collaboration breadth (distinct agents interacted with)
  const collabRes = await pool.query(
    `select count(distinct e2.agent_id) as distinct_agents
     from ox_live_events e1
     join ox_live_events e2
       on e1.deployment_target = e2.deployment_target
       and e2.agent_id != $1
       and e2.ts between e1.ts - interval '30 seconds' and e1.ts + interval '30 seconds'
     where e1.agent_id = $1
       and e1.ts >= $2
       and e1.ts <= $3
       and e1.type like 'agent.action_%'`,
    [agentId, windowStart, windowEnd],
  );

  const collaborationBreadth = Number(collabRes.rows[0]?.distinct_agents ?? 0);

  // Build observation (descriptive, not judgmental)
  const observation = {
    action_frequency: actionFrequency,
    total_actions: totalActions,
    collaboration_breadth: collaborationBreadth,
    window_hours: PATTERN_WINDOW_HOURS,
  };

  // Upsert pattern
  await pool.query(
    `insert into ox_agent_patterns (agent_id, pattern_type, window_start, window_end, observation_json, event_count)
     values ($1, 'activity_summary', $2, $3, $4, $5)
     on conflict (agent_id, pattern_type, window_start)
     do update set observation_json = $4, event_count = $5`,
    [agentId, windowStart, windowEnd, JSON.stringify(observation), totalActions],
  );
};

// --- Event handler (idempotent) ---

const handleEvent = async (event: EventEnvelope<AgentEventPayload>): Promise<void> => {
  const payload = event.payload;
  const agentId = payload.agent_id;
  const deploymentTarget = payload.deployment_target ?? 'unknown';
  const actionType = payload.action_type ?? null;
  const eventTs = new Date(event.occurred_at);

  const summary = buildSummary(event.event_type, payload);

  // 1. Materialize to ox_live_events (idempotent)
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
        null, // session_id updated below if applicable
        JSON.stringify(summary),
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.error({ err, event_id: event.event_id }, 'Failed to materialize event');
    throw err;
  }

  // 2. Session derivation (for action events)
  try {
    const sessionId = await findOrCreateSession(
      agentId,
      deploymentTarget,
      eventTs,
      event.event_type,
      actionType,
    );

    if (sessionId) {
      // Link event to session
      await addEventToSession(
        sessionId,
        event.event_id,
        agentId,
        eventTs,
        event.event_type,
        actionType,
        summary,
      );

      // Update session topic heuristically
      await updateSessionTopic(sessionId);

      // Update ox_live_events with session_id
      await pool.query(
        `update ox_live_events set session_id = $2 where source_event_id = $1`,
        [event.event_id, sessionId],
      );
    }
  } catch (err) {
    // Log but don't fail event processing for session derivation errors
    app.log.warn({ err, event_id: event.event_id }, 'Session derivation warning');
  }

  // 3. Pattern update (background, non-blocking)
  try {
    await updateAgentPatterns(agentId, eventTs, event.event_type, actionType);
  } catch (err) {
    // Log but don't fail event processing for pattern errors
    app.log.warn({ err, event_id: event.event_id }, 'Pattern update warning');
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
  }
};

// --- Health endpoints ---

app.get('/healthz', async () => ({ ok: true }));

app.get('/readyz', async () => {
  const checks: Record<string, boolean> = {};

  try {
    await pool.query('select 1');
    checks.db = true;
  } catch {
    checks.db = false;
  }

  checks.consumer = consumerInitialized;

  const ready = checks.db && checks.consumer;
  return { ready, checks };
});

// --- Read-only API: Live Events ---

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

// --- Read-only API: Sessions ---

interface SessionsQueryParams {
  limit?: string;
}

app.get('/ox/sessions', async (request) => {
  const query = request.query as SessionsQueryParams;
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

  const res = await pool.query(
    `select session_id, start_ts, end_ts, participating_agent_ids, deployment_target,
            derived_topic, event_count, is_active
     from ox_sessions
     order by start_ts desc
     limit $1`,
    [limit],
  );

  return {
    sessions: res.rows.map((row) => ({
      session_id: row.session_id,
      start_ts: row.start_ts,
      end_ts: row.end_ts,
      participating_agent_ids: row.participating_agent_ids,
      deployment_target: row.deployment_target,
      derived_topic: row.derived_topic,
      event_count: row.event_count,
      is_active: row.is_active,
    })),
  };
});

app.get('/ox/sessions/:id', async (request, reply) => {
  const { id } = request.params as { id: string };

  const sessionRes = await pool.query(
    `select session_id, start_ts, end_ts, participating_agent_ids, deployment_target,
            derived_topic, event_count, is_active
     from ox_sessions
     where session_id = $1`,
    [id],
  );

  if (sessionRes.rowCount === 0) {
    reply.status(404);
    return { error: 'session not found' };
  }

  const session = sessionRes.rows[0];

  const eventsRes = await pool.query(
    `select source_event_id, agent_id, ts, event_type, action_type, summary_json as summary
     from ox_session_events
     where session_id = $1
     order by ts asc`,
    [id],
  );

  return {
    session: {
      session_id: session.session_id,
      start_ts: session.start_ts,
      end_ts: session.end_ts,
      participating_agent_ids: session.participating_agent_ids,
      deployment_target: session.deployment_target,
      derived_topic: session.derived_topic,
      event_count: session.event_count,
      is_active: session.is_active,
    },
    events: eventsRes.rows.map((row) => ({
      event_id: row.source_event_id,
      agent_id: row.agent_id,
      ts: row.ts,
      event_type: row.event_type,
      action_type: row.action_type,
      summary: row.summary,
    })),
  };
});

// --- Read-only API: Patterns ---

app.get('/ox/agents/:id/patterns', async (request, reply) => {
  const { id } = request.params as { id: string };

  const res = await pool.query(
    `select pattern_type, window_start, window_end, observation_json as observation, event_count, created_at
     from ox_agent_patterns
     where agent_id = $1
     order by window_end desc
     limit 10`,
    [id],
  );

  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'no patterns found for agent' };
  }

  return {
    agent_id: id,
    patterns: res.rows.map((row) => ({
      pattern_type: row.pattern_type,
      window_start: row.window_start,
      window_end: row.window_end,
      observation: row.observation,
      event_count: row.event_count,
      created_at: row.created_at,
    })),
  };
});

// --- Start server ---

const start = async () => {
  const port = Number(process.env.PORT ?? 4018);

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
