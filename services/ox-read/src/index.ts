import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ensureCorrelationId, getPool, rateLimitMiddleware } from '@platform/shared';
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

// Observation delay (Phase E1) - configurable per deployment
const DEFAULT_OBSERVATION_DELAY_MS = 0;
const DEPLOYMENT_DELAY_OVERRIDES: Record<string, number> = {
  // Can be configured per deployment target
  // 'production': 5000, // 5 second delay for production
};

// Rate limiting (Phase E2)
const RATE_LIMIT_CONFIG = {
  live: { key: 'ox_live', limit: 60, windowSec: 60 },
  sessions: { key: 'ox_sessions', limit: 30, windowSec: 60 },
  artifacts: { key: 'ox_artifacts', limit: 30, windowSec: 60 },
};

// Artifact types
const ARTIFACT_TYPES = ['proposal', 'message', 'diagram', 'dataset'] as const;
type ArtifactType = (typeof ARTIFACT_TYPES)[number];

// --- Consumer state ---

let consumerInitialized = false;

// --- Event type definitions ---

interface CognitionData {
  provider: string;
  tokens_used: number;
  estimated_cost: number;
  actual_cost: number;
  latency_ms: number;
}

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
  cognition?: CognitionData;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

// --- Observer Audit Helper (Phase E3) ---

const logObserverAccess = async (
  endpoint: string,
  queryParams: Record<string, unknown>,
  responseCount: number,
  observerId?: string,
): Promise<void> => {
  try {
    await pool.query(
      `insert into observer_access_log (observer_id, endpoint, query_params_json, response_count)
       values ($1, $2, $3, $4)`,
      [observerId ?? null, endpoint, JSON.stringify(queryParams), responseCount],
    );
  } catch (err) {
    // Don't fail the request if audit logging fails
    app.log.warn({ err }, 'Failed to log observer access');
  }
};

// --- Observation Delay Helper (Phase E1) ---

const getObservationDelay = (deploymentTarget: string): number => {
  return DEPLOYMENT_DELAY_OVERRIDES[deploymentTarget] ?? DEFAULT_OBSERVATION_DELAY_MS;
};

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

// --- Artifact projection logic (Phase C) ---

/**
 * Derive artifact from action event if applicable.
 * Artifacts are derived from specific action types with payload content.
 */
const deriveArtifact = async (
  event: EventEnvelope<AgentEventPayload>,
  sessionId: string | null,
): Promise<void> => {
  const payload = event.payload;

  // Only derive artifacts from accepted actions
  if (event.event_type !== 'agent.action_accepted') {
    return;
  }

  // Determine artifact type based on action type and payload
  let artifactType: ArtifactType | null = null;
  let title: string | null = null;
  let contentSummary: string | null = null;

  const actionType = payload.action_type;
  const actionPayload = payload.payload;

  switch (actionType) {
    case 'communicate':
      artifactType = 'message';
      title = 'Communication';
      contentSummary = actionPayload?.message
        ? String(actionPayload.message).slice(0, 200)
        : 'Agent communication';
      break;
    case 'create':
      // Check payload for hints about what was created
      if (actionPayload?.type === 'proposal') {
        artifactType = 'proposal';
        title = actionPayload?.title ? String(actionPayload.title) : 'Proposal';
        contentSummary = actionPayload?.summary ? String(actionPayload.summary).slice(0, 200) : null;
      } else if (actionPayload?.type === 'diagram') {
        artifactType = 'diagram';
        title = actionPayload?.title ? String(actionPayload.title) : 'Diagram';
        contentSummary = 'Visual artifact (metadata only)';
      } else if (actionPayload?.type === 'dataset') {
        artifactType = 'dataset';
        title = actionPayload?.title ? String(actionPayload.title) : 'Dataset';
        contentSummary = 'Data artifact (metadata only)';
      }
      break;
    case 'exchange':
      artifactType = 'message';
      title = 'Exchange';
      contentSummary = 'Exchange between agents';
      break;
  }

  if (!artifactType) {
    return;
  }

  // Build metadata
  const metadata: Record<string, unknown> = {
    action_type: actionType,
    cost: payload.requested_cost,
  };

  if (payload.cognition) {
    metadata.cognition = {
      provider: payload.cognition.provider,
      tokens_used: payload.cognition.tokens_used,
    };
  }

  // Insert artifact (idempotent)
  await pool.query(
    `insert into ox_artifacts (artifact_type, source_session_id, source_event_id, agent_id, deployment_target, title, content_summary, metadata_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (source_event_id, artifact_type) do nothing`,
    [
      artifactType,
      sessionId,
      event.event_id,
      payload.agent_id,
      payload.deployment_target ?? 'unknown',
      title,
      contentSummary,
      JSON.stringify(metadata),
    ],
  );
};

// --- Capacity timeline projection logic (Phase D) ---

/**
 * Project capacity changes to timeline for economic visibility.
 */
const projectCapacityChange = async (
  event: EventEnvelope<AgentEventPayload>,
): Promise<void> => {
  const payload = event.payload;

  // Only track action events that affect capacity
  if (!event.event_type.startsWith('agent.action_')) {
    return;
  }

  // Build cost breakdown
  const costBreakdown: Record<string, unknown> = {
    base_cost: payload.requested_cost ?? 0,
    action_type: payload.action_type,
    accepted: payload.accepted,
  };

  if (payload.cognition) {
    costBreakdown.cognition = {
      provider: payload.cognition.provider,
      estimated_cost: payload.cognition.estimated_cost,
      actual_cost: payload.cognition.actual_cost,
      tokens_used: payload.cognition.tokens_used,
      latency_ms: payload.cognition.latency_ms,
    };
    costBreakdown.total_cost =
      (payload.requested_cost ?? 0) + payload.cognition.actual_cost;
  } else {
    costBreakdown.total_cost = payload.requested_cost ?? 0;
  }

  // Calculate balance before (from remaining_balance + cost if accepted)
  const remainingBalance = payload.remaining_balance ?? 0;
  const totalCost = payload.accepted ? (costBreakdown.total_cost as number) : 0;
  const balanceBefore = remainingBalance + totalCost;

  // Insert timeline entry (idempotent)
  await pool.query(
    `insert into ox_capacity_timeline (agent_id, ts, event_type, balance_before, balance_after, cost_breakdown_json, source_event_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (source_event_id) do nothing`,
    [
      payload.agent_id,
      event.occurred_at,
      event.event_type,
      balanceBefore,
      remainingBalance,
      JSON.stringify(costBreakdown),
      event.event_id,
    ],
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

  // 2. Apply observation delay (Phase E1)
  const delay = getObservationDelay(deploymentTarget);
  if (delay > 0) {
    await new Promise((r) => setTimeout(r, delay));
  }

  // 3. Session derivation (for action events)
  let sessionId: string | null = null;
  try {
    sessionId = await findOrCreateSession(
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

  // 4. Pattern update (background, non-blocking)
  try {
    await updateAgentPatterns(agentId, eventTs, event.event_type, actionType);
  } catch (err) {
    // Log but don't fail event processing for pattern errors
    app.log.warn({ err, event_id: event.event_id }, 'Pattern update warning');
  }

  // 5. Artifact derivation (Phase C)
  try {
    await deriveArtifact(event, sessionId);
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Artifact derivation warning');
  }

  // 6. Capacity timeline projection (Phase D)
  try {
    await projectCapacityChange(event);
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Capacity timeline projection warning');
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

app.get('/ox/live', {
  preHandler: rateLimitMiddleware(RATE_LIMIT_CONFIG.live),
}, async (request) => {
  const query = request.query as LiveQueryParams;
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, ts, type, agent_id, deployment_target, action_type, session_id, summary_json as summary
     from ox_live_events
     order by ts desc
     limit $1`,
    [limit],
  );

  // Log observer access (Phase E3)
  await logObserverAccess('/ox/live', query as Record<string, unknown>, res.rowCount ?? 0, observerId);

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

app.get('/ox/sessions', {
  preHandler: rateLimitMiddleware(RATE_LIMIT_CONFIG.sessions),
}, async (request) => {
  const query = request.query as SessionsQueryParams;
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

  const res = await pool.query(
    `select session_id, start_ts, end_ts, participating_agent_ids, deployment_target,
            derived_topic, event_count, is_active
     from ox_sessions
     order by start_ts desc
     limit $1`,
    [limit],
  );

  // Log observer access
  await logObserverAccess('/ox/sessions', query as Record<string, unknown>, res.rowCount ?? 0, observerId);

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
  const observerId = request.headers['x-observer-id'] as string | undefined;

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

  // Log observer access
  await logObserverAccess(`/ox/sessions/${id}`, {}, eventsRes.rowCount ?? 0, observerId);

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

// --- Read-only API: Artifacts (Phase C) ---

interface ArtifactsQueryParams {
  session_id?: string;
  agent_id?: string;
  artifact_type?: string;
  limit?: string;
}

app.get('/ox/artifacts', {
  preHandler: rateLimitMiddleware(RATE_LIMIT_CONFIG.artifacts),
}, async (request) => {
  const query = request.query as ArtifactsQueryParams;
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  let sql = `
    select id, artifact_type, source_session_id, source_event_id, agent_id, deployment_target,
           title, content_summary, metadata_json as metadata, created_at
    from ox_artifacts
    where 1=1
  `;
  const params: unknown[] = [];
  let paramIndex = 1;

  if (query.session_id) {
    sql += ` and source_session_id = $${paramIndex++}`;
    params.push(query.session_id);
  }
  if (query.agent_id) {
    sql += ` and agent_id = $${paramIndex++}`;
    params.push(query.agent_id);
  }
  if (query.artifact_type) {
    sql += ` and artifact_type = $${paramIndex++}`;
    params.push(query.artifact_type);
  }

  sql += ` order by created_at desc limit $${paramIndex}`;
  params.push(limit);

  const res = await pool.query(sql, params);

  // Log observer access (Phase E3)
  await logObserverAccess('/ox/artifacts', query as Record<string, unknown>, res.rowCount ?? 0, observerId);

  return {
    artifacts: res.rows.map((row) => ({
      id: row.id,
      artifact_type: row.artifact_type,
      source_session_id: row.source_session_id,
      source_event_id: row.source_event_id,
      agent_id: row.agent_id,
      deployment_target: row.deployment_target,
      title: row.title,
      content_summary: row.content_summary,
      metadata: row.metadata,
      created_at: row.created_at,
    })),
  };
});

app.get('/ox/artifacts/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;

  const res = await pool.query(
    `select id, artifact_type, source_session_id, source_event_id, agent_id, deployment_target,
            title, content_summary, metadata_json as metadata, created_at
     from ox_artifacts
     where id = $1`,
    [id],
  );

  // Log observer access
  await logObserverAccess(`/ox/artifacts/${id}`, {}, res.rowCount ?? 0, observerId);

  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'artifact not found' };
  }

  const row = res.rows[0];
  return {
    artifact: {
      id: row.id,
      artifact_type: row.artifact_type,
      source_session_id: row.source_session_id,
      source_event_id: row.source_event_id,
      agent_id: row.agent_id,
      deployment_target: row.deployment_target,
      title: row.title,
      content_summary: row.content_summary,
      metadata: row.metadata,
      created_at: row.created_at,
    },
  };
});

// --- Read-only API: Economics (Phase D) ---

app.get('/ox/agents/:id/economics', async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = request.query as { hours?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const hours = Math.min(Math.max(Number(query.hours) || 24, 1), 168); // Max 1 week

  const windowStart = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Get capacity timeline
  const timelineRes = await pool.query(
    `select ts, event_type, balance_before, balance_after, cost_breakdown_json as cost_breakdown
     from ox_capacity_timeline
     where agent_id = $1 and ts >= $2
     order by ts desc
     limit 500`,
    [id, windowStart],
  );

  if (timelineRes.rowCount === 0) {
    reply.status(404);
    return { error: 'no economic data found for agent' };
  }

  // Calculate aggregate statistics
  let totalCost = 0;
  let totalCognitionCost = 0;
  let actionsAccepted = 0;
  let actionsRejected = 0;
  const cognitionByProvider: Record<string, { count: number; tokens: number; cost: number }> = {};

  for (const row of timelineRes.rows) {
    const breakdown = row.cost_breakdown;
    if (breakdown.accepted) {
      actionsAccepted++;
      totalCost += breakdown.total_cost ?? 0;
      if (breakdown.cognition) {
        totalCognitionCost += breakdown.cognition.actual_cost ?? 0;
        const provider = breakdown.cognition.provider;
        if (!cognitionByProvider[provider]) {
          cognitionByProvider[provider] = { count: 0, tokens: 0, cost: 0 };
        }
        cognitionByProvider[provider].count++;
        cognitionByProvider[provider].tokens += breakdown.cognition.tokens_used ?? 0;
        cognitionByProvider[provider].cost += breakdown.cognition.actual_cost ?? 0;
      }
    } else {
      actionsRejected++;
    }
  }

  // Calculate burn rate (cost per hour)
  const oldestEvent = timelineRes.rows[timelineRes.rows.length - 1];
  const newestEvent = timelineRes.rows[0];
  const timeSpanHours =
    (new Date(newestEvent.ts).getTime() - new Date(oldestEvent.ts).getTime()) / (1000 * 60 * 60);
  const burnRate = timeSpanHours > 0 ? totalCost / timeSpanHours : 0;

  // Log observer access
  await logObserverAccess(`/ox/agents/${id}/economics`, { hours }, timelineRes.rowCount ?? 0, observerId);

  return {
    agent_id: id,
    window_hours: hours,
    summary: {
      total_cost: totalCost,
      total_cognition_cost: totalCognitionCost,
      base_cost: totalCost - totalCognitionCost,
      actions_accepted: actionsAccepted,
      actions_rejected: actionsRejected,
      burn_rate_per_hour: Math.round(burnRate * 100) / 100,
      cognition_by_provider: cognitionByProvider,
    },
    timeline: timelineRes.rows.map((row) => ({
      ts: row.ts,
      event_type: row.event_type,
      balance_before: row.balance_before,
      balance_after: row.balance_after,
      cost_breakdown: row.cost_breakdown,
    })),
  };
});

// --- Read-only API: System Self-Inspection (Phase F) ---

app.get('/ox/system/throughput', async (request) => {
  const query = request.query as { hours?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const hours = Math.min(Math.max(Number(query.hours) || 1, 1), 24);
  const windowStart = new Date(Date.now() - hours * 60 * 60 * 1000);

  const res = await pool.query(
    `select
       count(*) as total_events,
       count(distinct agent_id) as unique_agents,
       count(*) filter (where type = 'agent.action_accepted') as accepted,
       count(*) filter (where type = 'agent.action_rejected') as rejected,
       min(ts) as earliest,
       max(ts) as latest
     from ox_live_events
     where ts >= $1`,
    [windowStart],
  );

  const row = res.rows[0];
  const timeSpanMs = row.latest && row.earliest
    ? new Date(row.latest).getTime() - new Date(row.earliest).getTime()
    : 0;
  const eventsPerMinute = timeSpanMs > 0
    ? (Number(row.total_events) / (timeSpanMs / 60000))
    : 0;

  await logObserverAccess('/ox/system/throughput', { hours }, 1, observerId);

  return {
    window_hours: hours,
    total_events: Number(row.total_events),
    unique_agents: Number(row.unique_agents),
    events_per_minute: Math.round(eventsPerMinute * 100) / 100,
    accepted_actions: Number(row.accepted),
    rejected_actions: Number(row.rejected),
    earliest_event: row.earliest,
    latest_event: row.latest,
  };
});

app.get('/ox/system/event-lag', async (request) => {
  const observerId = request.headers['x-observer-id'] as string | undefined;

  // Get the most recent events and their materialization times
  const res = await pool.query(
    `select
       source_event_id,
       ts as event_ts,
       -- Estimate lag from consumer offsets or event processing
       extract(epoch from (now() - ts)) as seconds_since_event
     from ox_live_events
     order by ts desc
     limit 10`,
  );

  // Get consumer offset info
  const offsetRes = await pool.query(
    `select topic, partition_id, offset_value, updated_at
     from consumer_offsets
     where consumer_group = 'ox-read-materializer'`,
  );

  await logObserverAccess('/ox/system/event-lag', {}, res.rowCount ?? 0, observerId);

  return {
    recent_events: res.rows.map((row) => ({
      event_id: row.source_event_id,
      event_ts: row.event_ts,
      seconds_since: Math.round(Number(row.seconds_since_event)),
    })),
    consumer_offsets: offsetRes.rows.map((row) => ({
      topic: row.topic,
      partition_id: row.partition_id,
      offset: Number(row.offset_value),
      updated_at: row.updated_at,
    })),
    consumer_status: consumerInitialized ? 'running' : 'not_started',
  };
});

app.get('/ox/system/projection-health', async (request) => {
  const observerId = request.headers['x-observer-id'] as string | undefined;

  // Get counts from all projection tables
  const [liveRes, sessionsRes, patternsRes, artifactsRes, timelineRes, accessRes] = await Promise.all([
    pool.query('select count(*) as count from ox_live_events'),
    pool.query('select count(*) as count, count(*) filter (where is_active) as active from ox_sessions'),
    pool.query('select count(*) as count from ox_agent_patterns'),
    pool.query('select count(*) as count from ox_artifacts'),
    pool.query('select count(*) as count from ox_capacity_timeline'),
    pool.query('select count(*) as count from observer_access_log where accessed_at > now() - interval \'1 hour\''),
  ]);

  await logObserverAccess('/ox/system/projection-health', {}, 1, observerId);

  return {
    projections: {
      ox_live_events: Number(liveRes.rows[0].count),
      ox_sessions: {
        total: Number(sessionsRes.rows[0].count),
        active: Number(sessionsRes.rows[0].active),
      },
      ox_agent_patterns: Number(patternsRes.rows[0].count),
      ox_artifacts: Number(artifactsRes.rows[0].count),
      ox_capacity_timeline: Number(timelineRes.rows[0].count),
    },
    observer_access_last_hour: Number(accessRes.rows[0].count),
    consumer_initialized: consumerInitialized,
    health: consumerInitialized ? 'healthy' : 'degraded',
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
