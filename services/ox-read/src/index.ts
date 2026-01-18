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

// Artifact types (extended for Axis 1: Inter-agent perception)
const ARTIFACT_TYPES = [
  'proposal', 'message', 'diagram', 'dataset',
  // Inter-agent perception artifacts (non-communicative)
  'critique', 'counter_model', 'refusal', 'rederivation',
] as const;
type ArtifactType = (typeof ARTIFACT_TYPES)[number];

// Inter-agent perception artifact types
const PERCEPTION_ARTIFACT_TYPES = ['critique', 'counter_model', 'refusal', 'rederivation'] as const;

// Observer roles (Axis 3)
const OBSERVER_ROLES = ['viewer', 'analyst', 'auditor'] as const;
type ObserverRole = (typeof OBSERVER_ROLES)[number];

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
  // Axis 1: Inter-agent perception
  subject_agent_id?: string;
  issuing_agent_id?: string;
  artifact_type?: string;
  implication_type?: string;
  source_event_id?: string;
  // Axis 2: Environment events
  previous_state?: Record<string, unknown>;
  new_state?: Record<string, unknown>;
  rejection_reason?: string;
  environment_state?: Record<string, unknown>;
  [key: string]: unknown;
}

// Phase 6: Physics event payload (matches ox-physics tick events)
interface PhysicsState {
  current_throughput_cap?: number;
  current_throttle_factor?: number;
  current_cognition_availability?: string;
  current_burst_allowance?: number;
  weather_state?: string;
  active_regime_name?: string;
  [key: string]: unknown;
}

interface PhysicsEventPayload {
  deployment_target: string;
  previous_state?: PhysicsState;
  new_state?: PhysicsState;
  changes?: string[];
  weather_event?: string | null;
  weather_state?: string; // For weather-specific events
  [key: string]: unknown;
}

// --- Observer Helpers (Axis 3) ---

/**
 * Get observer role from header or registry.
 * Returns 'viewer' by default (most restricted).
 */
const getObserverRole = async (observerId?: string, headerRole?: string): Promise<ObserverRole> => {
  // If role specified in header and valid, use it
  if (headerRole && OBSERVER_ROLES.includes(headerRole as ObserverRole)) {
    return headerRole as ObserverRole;
  }

  // If observer is registered, get their role
  if (observerId) {
    try {
      const res = await pool.query(
        `select observer_role from ox_observers where observer_id = $1`,
        [observerId],
      );
      if (res.rowCount && res.rowCount > 0) {
        return res.rows[0].observer_role as ObserverRole;
      }
    } catch {
      // Fall through to default
    }
  }

  return 'viewer';
};

/**
 * Log observer access with role (Axis 3).
 */
const logObserverAccess = async (
  endpoint: string,
  queryParams: Record<string, unknown>,
  responseCount: number,
  observerId?: string,
  observerRole?: ObserverRole,
): Promise<void> => {
  try {
    await pool.query(
      `insert into observer_access_log (observer_id, endpoint, query_params_json, response_count, observer_role)
       values ($1, $2, $3, $4, $5::observer_role)`,
      [observerId ?? null, endpoint, JSON.stringify(queryParams), responseCount, observerRole ?? 'viewer'],
    );

    // Update observer last_seen if registered
    if (observerId) {
      await pool.query(
        `update ox_observers
         set last_seen_at = now(), access_count = access_count + 1
         where observer_id = $1`,
        [observerId],
      );
    }
  } catch (err) {
    // Don't fail the request if audit logging fails
    app.log.warn({ err }, 'Failed to log observer access');
  }
};

/**
 * Check if observer role can access the endpoint.
 * Viewer: Basic live data only
 * Analyst: + Patterns, economics, artifacts
 * Auditor: + Full system health, all projections
 */
const canAccessEndpoint = (role: ObserverRole, endpoint: string): boolean => {
  // Viewer can access: /ox/live, /ox/sessions, basic artifact list
  const viewerEndpoints = ['/ox/live', '/ox/sessions'];

  // Auditor-only endpoints: /ox/system/*, /ox/environment/*, /ox/observers/*, /ox/drift/*
  const auditorEndpoints = ['/ox/system', '/ox/environment', '/ox/observers', '/ox/drift'];

  if (role === 'auditor') return true;

  if (role === 'analyst') {
    // Analyst can access everything except auditor-only endpoints
    const isAuditorOnly = auditorEndpoints.some(e => endpoint.startsWith(e));
    return !isAuditorOnly;
  }

  // Viewer - most restricted
  return viewerEndpoints.some(e => endpoint.startsWith(e));
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

// --- Artifact projection logic (Phase C + Axis 1) ---

/**
 * Derive artifact from action event if applicable.
 * Artifacts are derived from specific action types with payload content.
 * Extended for Axis 1: Inter-agent perception artifacts.
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
  let subjectAgentId: string | null = null;

  const actionType = payload.action_type;
  const actionPayload = payload.payload;

  // Axis 1: Inter-agent perception artifacts
  if (PERCEPTION_ARTIFACT_TYPES.includes(actionType as typeof PERCEPTION_ARTIFACT_TYPES[number])) {
    artifactType = actionType as ArtifactType;
    subjectAgentId = payload.subject_agent_id ?? null;

    switch (actionType) {
      case 'critique':
        title = 'Critique';
        contentSummary = actionPayload?.summary
          ? String(actionPayload.summary).slice(0, 200)
          : 'Agent critique of another agent\'s behavior';
        break;
      case 'counter_model':
        title = 'Counter-Model';
        contentSummary = actionPayload?.summary
          ? String(actionPayload.summary).slice(0, 200)
          : 'Alternative behavioral model proposed';
        break;
      case 'refusal':
        title = 'Refusal';
        contentSummary = actionPayload?.reason
          ? String(actionPayload.reason).slice(0, 200)
          : 'Agent refused interaction with another agent';
        break;
      case 'rederivation':
        title = 'Rederivation';
        contentSummary = actionPayload?.summary
          ? String(actionPayload.summary).slice(0, 200)
          : 'Agent rederived conclusions from another agent\'s work';
        break;
    }
  } else {
    // Original artifact derivation logic
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

  // Insert artifact (idempotent) with subject_agent_id for inter-agent perception
  await pool.query(
    `insert into ox_artifacts (artifact_type, source_session_id, source_event_id, agent_id, deployment_target, title, content_summary, metadata_json, subject_agent_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      subjectAgentId,
    ],
  );

  // Axis 1: Record artifact implication if this is a perception artifact
  if (subjectAgentId && PERCEPTION_ARTIFACT_TYPES.includes(artifactType as typeof PERCEPTION_ARTIFACT_TYPES[number])) {
    // Get the artifact ID we just inserted
    const artifactRes = await pool.query(
      `select id from ox_artifacts where source_event_id = $1 and artifact_type = $2`,
      [event.event_id, artifactType],
    );

    if (artifactRes.rowCount && artifactRes.rowCount > 0) {
      await pool.query(
        `insert into ox_artifact_implications (artifact_id, issuing_agent_id, subject_agent_id, implication_type, source_event_id)
         values ($1, $2, $3, $4, $5)
         on conflict (source_event_id) do nothing`,
        [
          artifactRes.rows[0].id,
          payload.agent_id,
          subjectAgentId,
          artifactType,
          event.event_id,
        ],
      );
    }
  }
};

// --- Axis 2: Environment projection logic ---

/**
 * Project environment state changes to history.
 */
const projectEnvironmentChange = async (
  event: EventEnvelope<AgentEventPayload>,
): Promise<void> => {
  if (!event.event_type.startsWith('environment.')) {
    return;
  }

  const payload = event.payload;
  const deploymentTarget = payload.deployment_target as string;

  let changeType = 'updated';
  if (event.event_type === 'environment.state_removed') {
    changeType = 'removed';
  } else if (!payload.previous_state) {
    changeType = 'created';
  }

  await pool.query(
    `insert into ox_environment_history (deployment_target, previous_state_json, new_state_json, change_type, source_event_id)
     values ($1, $2, $3, $4, $5)
     on conflict (source_event_id) do nothing`,
    [
      deploymentTarget,
      payload.previous_state ? JSON.stringify(payload.previous_state) : null,
      payload.new_state ? JSON.stringify(payload.new_state) : '{}',
      changeType,
      event.event_id,
    ],
  );

  // Upsert current state projection
  if (event.event_type === 'environment.state_changed' && payload.new_state) {
    const newState = payload.new_state;
    await pool.query(
      `insert into ox_environment_states (deployment_target, cognition_availability, max_throughput_per_minute, throttle_factor, active_window_start, active_window_end, imposed_at, reason)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (deployment_target)
       do update set
         cognition_availability = $2,
         max_throughput_per_minute = $3,
         throttle_factor = $4,
         active_window_start = $5,
         active_window_end = $6,
         imposed_at = $7,
         reason = $8`,
      [
        deploymentTarget,
        newState.cognition_availability ?? 'full',
        newState.max_throughput_per_minute ?? null,
        newState.throttle_factor ?? 1.0,
        newState.active_window_start ?? null,
        newState.active_window_end ?? null,
        event.occurred_at,
        newState.reason ?? null,
      ],
    );
  } else if (event.event_type === 'environment.state_removed') {
    await pool.query(
      `delete from ox_environment_states where deployment_target = $1`,
      [deploymentTarget],
    );
  }
};

/**
 * Project environment rejections for correlation.
 */
const projectEnvironmentRejection = async (
  event: EventEnvelope<AgentEventPayload>,
): Promise<void> => {
  if (event.event_type !== 'agent.action_rejected.environment') {
    return;
  }

  const payload = event.payload;

  await pool.query(
    `insert into ox_environment_rejections (agent_id, deployment_target, rejection_reason, environment_state_json, source_event_id)
     values ($1, $2, $3, $4, $5)
     on conflict (source_event_id) do nothing`,
    [
      payload.agent_id,
      payload.deployment_target ?? 'unknown',
      payload.rejection_reason ?? 'unknown',
      JSON.stringify(payload.environment_state ?? {}),
      event.event_id,
    ],
  );
};

// --- Axis 4: Deployment patterns projection logic ---

/**
 * Update deployment-specific patterns after processing an event.
 * Tracks behavior differences across deployment targets.
 */
const updateDeploymentPatterns = async (
  agentId: string,
  deploymentTarget: string,
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

  // Compute deployment-specific action frequency
  const freqRes = await pool.query(
    `select
       action_type,
       count(*) as count,
       count(*) filter (where type = 'agent.action_accepted') as accepted_count,
       count(*) filter (where type = 'agent.action_rejected') as rejected_count
     from ox_live_events
     where agent_id = $1
       and deployment_target = $2
       and ts >= $3
       and ts <= $4
       and type like 'agent.action_%'
     group by action_type`,
    [agentId, deploymentTarget, windowStart, windowEnd],
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

  // Build observation
  const observation = {
    action_frequency: actionFrequency,
    total_actions: totalActions,
    window_hours: PATTERN_WINDOW_HOURS,
    deployment_target: deploymentTarget,
  };

  // Upsert deployment pattern
  await pool.query(
    `insert into ox_agent_deployment_patterns (agent_id, deployment_target, pattern_type, window_start, window_end, observation_json, event_count)
     values ($1, $2, 'activity_summary', $3, $4, $5, $6)
     on conflict (agent_id, deployment_target, pattern_type, window_start)
     do update set observation_json = $5, event_count = $6`,
    [agentId, deploymentTarget, windowStart, windowEnd, JSON.stringify(observation), totalActions],
  );
};

/**
 * Compute drift between deployment targets for an agent.
 * Called periodically or on-demand.
 */
const computeDeploymentDrift = async (
  agentId: string,
  windowEnd: Date,
): Promise<void> => {
  // Get all deployment patterns for this agent at this window
  const patternsRes = await pool.query(
    `select deployment_target, observation_json
     from ox_agent_deployment_patterns
     where agent_id = $1 and window_end = $2 and pattern_type = 'activity_summary'`,
    [agentId, windowEnd],
  );

  if ((patternsRes.rowCount ?? 0) < 2) {
    return; // Need at least 2 deployments to compute drift
  }

  const patterns = patternsRes.rows;

  // Compare each pair of deployments
  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      const deployA = patterns[i].deployment_target;
      const deployB = patterns[j].deployment_target;
      const obsA = patterns[i].observation_json;
      const obsB = patterns[j].observation_json;

      // Compute drift summary
      const driftSummary: Record<string, unknown> = {
        total_actions_delta: (obsA.total_actions ?? 0) - (obsB.total_actions ?? 0),
        action_type_differences: {} as Record<string, unknown>,
      };

      // Find action type differences
      const allActionTypes = new Set([
        ...Object.keys(obsA.action_frequency ?? {}),
        ...Object.keys(obsB.action_frequency ?? {}),
      ]);

      for (const actionType of allActionTypes) {
        const freqA = obsA.action_frequency?.[actionType] ?? { total: 0, accepted: 0, rejected: 0 };
        const freqB = obsB.action_frequency?.[actionType] ?? { total: 0, accepted: 0, rejected: 0 };

        (driftSummary.action_type_differences as Record<string, unknown>)[actionType] = {
          total_delta: freqA.total - freqB.total,
          acceptance_rate_a: freqA.total > 0 ? freqA.accepted / freqA.total : null,
          acceptance_rate_b: freqB.total > 0 ? freqB.accepted / freqB.total : null,
        };
      }

      // Upsert drift record
      await pool.query(
        `insert into ox_deployment_drift (agent_id, deployment_a, deployment_b, pattern_type, window_end, drift_summary_json)
         values ($1, $2, $3, 'activity_summary', $4, $5)
         on conflict (agent_id, deployment_a, deployment_b, pattern_type, window_end)
         do update set drift_summary_json = $5`,
        [agentId, deployA, deployB, windowEnd, JSON.stringify(driftSummary)],
      );
    }
  }
};

// --- Phase 6: World State Projection Logic ---

/**
 * Get the 5-minute bucket start for a given timestamp.
 */
const get5MinBucketStart = (ts: Date): Date => {
  const ms = ts.getTime();
  const bucketMs = Math.floor(ms / (5 * 60 * 1000)) * (5 * 60 * 1000);
  return new Date(bucketMs);
};

/**
 * Project physics event to world state tables.
 * Upserts current state, appends to history, updates rolling aggregates.
 */
const handlePhysicsEvent = async (event: EventEnvelope<PhysicsEventPayload>): Promise<void> => {
  const payload = event.payload;
  const deploymentTarget = payload.deployment_target;
  const eventTs = new Date(event.occurred_at);

  // Extract state from physics event structure
  // Physics events have new_state with weather_state, active_regime_name, etc.
  const newState = payload.new_state ?? {};
  const weatherState = newState.weather_state ?? payload.weather_state ?? 'clear';
  const regimeName = newState.active_regime_name ?? null;
  const reason = payload.weather_event ?? (payload.changes?.join(', ') ?? null);

  // Build vars object from the full new_state
  const vars: Record<string, unknown> = {
    throughput_cap: newState.current_throughput_cap,
    throttle_factor: newState.current_throttle_factor,
    cognition_availability: newState.current_cognition_availability,
    burst_allowance: newState.current_burst_allowance,
  };

  // 1. Upsert current world state
  try {
    await pool.query(
      `insert into ox_world_state (deployment_target, regime_name, weather_state, vars_json, updated_at, source_event_id)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (deployment_target)
       do update set
         regime_name = $2,
         weather_state = $3,
         vars_json = $4,
         updated_at = $5,
         source_event_id = $6`,
      [
        deploymentTarget,
        regimeName,
        weatherState,
        JSON.stringify(vars),
        eventTs,
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.error({ err, event_id: event.event_id }, 'Failed to upsert world state');
    throw err;
  }

  // 2. Append to world state history (idempotent)
  try {
    await pool.query(
      `insert into ox_world_state_history (ts, deployment_target, regime_name, weather_state, vars_json, reason, source_event_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (source_event_id) do nothing`,
      [
        eventTs,
        deploymentTarget,
        regimeName,
        weatherState,
        JSON.stringify(vars),
        reason,
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'World state history append warning');
  }

  // 3. Update rolling 5-minute effects aggregates
  try {
    const bucketStart = get5MinBucketStart(eventTs);

    // Get recent effect stats for this bucket
    const statsRes = await pool.query(
      `select
         count(*) filter (where type = 'agent.action_accepted') as accepted,
         count(*) filter (where type = 'agent.action_rejected') as rejected,
         count(distinct session_id) filter (where session_id is not null) as sessions,
         avg((summary_json->>'cost')::numeric) filter (where summary_json->>'cost' is not null) as avg_cost
       from ox_live_events
       where deployment_target = $1
         and ts >= $2
         and ts < $2 + interval '5 minutes'`,
      [deploymentTarget, bucketStart],
    );

    // Get provider counts separately to avoid nested aggregates
    const providersRes = await pool.query(
      `select
         coalesce(summary_json->>'cognition_provider', 'none') as provider,
         count(*) as count
       from ox_live_events
       where deployment_target = $1
         and ts >= $2
         and ts < $2 + interval '5 minutes'
         and summary_json->>'cognition_provider' is not null
       group by summary_json->>'cognition_provider'`,
      [deploymentTarget, bucketStart],
    );

    const providerCounts: Record<string, number> = {};
    for (const row of providersRes.rows) {
      providerCounts[row.provider] = Number(row.count);
    }

    const stats = statsRes.rows[0] ?? {};

    // Get artifact count for this bucket
    const artifactRes = await pool.query(
      `select count(*) as count
       from ox_artifacts
       where deployment_target = $1
         and created_at >= $2
         and created_at < $2 + interval '5 minutes'`,
      [deploymentTarget, bucketStart],
    );

    await pool.query(
      `insert into ox_world_effects_5m (bucket_start, deployment_target, accepted_count, rejected_count, sessions_created, artifacts_created, cognition_provider_counts, avg_requested_cost)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (bucket_start, deployment_target)
       do update set
         accepted_count = $3,
         rejected_count = $4,
         sessions_created = $5,
         artifacts_created = $6,
         cognition_provider_counts = $7,
         avg_requested_cost = $8`,
      [
        bucketStart,
        deploymentTarget,
        Number(stats.accepted ?? 0),
        Number(stats.rejected ?? 0),
        Number(stats.sessions ?? 0),
        Number(artifactRes.rows[0]?.count ?? 0),
        JSON.stringify(providerCounts),
        stats.avg_cost ?? null,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'World effects aggregate update warning');
  }

  // Phase 11: Handle braid-related events
  if (event.event_type === 'sponsor.braid_computed') {
    await projectBraidComputed(event as unknown as EventEnvelope<BraidEventPayload>);
  } else if (event.event_type === 'sponsor.interference_detected') {
    await projectInterferenceEvent(event as unknown as EventEnvelope<InterferenceEventPayload>);
  } else if (event.event_type === 'sponsor.pressure_decayed') {
    await projectPressureDecayed(event as unknown as EventEnvelope<PressureDecayedPayload>);
  } else if (event.event_type === 'sponsor.pressure_expired') {
    await projectPressureExpired(event as unknown as EventEnvelope<PressureExpiredPayload>);
  }

  // Phase 12: Handle collision events
  if (event.event_type === 'ox.collision.generated') {
    await projectCollisionGenerated(event as unknown as EventEnvelope<CollisionEventPayload>);
  }

  // Phase 13: Handle gravity window events
  if (event.event_type === 'ox.gravity_window.computed') {
    await projectGravityWindow(event as unknown as EventEnvelope<GravityWindowPayload>);
  }

  // Phase 14: Handle conflict chain events
  if (event.event_type === 'ox.conflict_chain.detected') {
    await projectConflictChain(event as unknown as EventEnvelope<ConflictChainPayload>);
  }

  // Phase 16: Handle silence window events
  if (event.event_type === 'ox.silence_window.detected') {
    await projectSilenceWindow(event as unknown as EventEnvelope<SilenceWindowPayload>);
  }

  // Phase 17: Handle wave events
  if (event.event_type === 'ox.wave.detected') {
    await projectWave(event as unknown as EventEnvelope<WavePayload>);
  }

  // Phase 18: Handle observer coupling events
  if (event.event_type === 'ox.observer_coupling.computed') {
    await projectObserverCoupling(event as unknown as EventEnvelope<ObserverCouplingPayload>);
  }

  // Phase 19: Handle structure events
  if (event.event_type === 'ox.structure.detected') {
    await projectStructure(event as unknown as EventEnvelope<StructurePayload>);
  }
};

// ============================================================================
// PHASE 11: Braid Projection Logic
// ============================================================================

interface BraidEventPayload extends PhysicsEventPayload {
  tick_id: string;
  braid_vector: {
    capacity: number;
    throttle: number;
    cognition: number;
    redeploy_bias: number;
  };
  active_pressure_count: number;
  total_intensity: number;
  interference_count: number;
}

interface InterferenceEventPayload extends PhysicsEventPayload {
  tick_id: string;
  pressure_a_id: string;
  pressure_b_id: string;
  sponsor_a_id: string;
  sponsor_b_id: string;
  interference_probability: number;
  reduction_factor: number;
}

interface PressureDecayedPayload extends PhysicsEventPayload {
  pressure_id: string;
  sponsor_id: string;
  pressure_type: string;
  original_magnitude: number;
  current_magnitude: number;
  decay_pct: number;
}

interface PressureExpiredPayload extends PhysicsEventPayload {
  pressure_id: string;
  sponsor_id: string;
  pressure_type: string;
  remaining_pct: number;
}

/**
 * Project braid computation to read tables.
 */
const projectBraidComputed = async (
  event: EventEnvelope<BraidEventPayload>,
): Promise<void> => {
  const payload = event.payload;
  const eventTs = new Date(event.occurred_at);

  try {
    // Insert braid projection
    await pool.query(
      `insert into ox_pressure_braids (
         deployment_target, computed_at, braid_vector_json,
         total_intensity, active_pressure_count, source_event_id
       ) values ($1, $2, $3, $4, $5, $6)
       on conflict (source_event_id) do nothing`,
      [
        payload.deployment_target,
        eventTs,
        JSON.stringify(payload.braid_vector),
        payload.total_intensity,
        payload.active_pressure_count,
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Braid projection warning');
  }
};

/**
 * Project interference event.
 */
const projectInterferenceEvent = async (
  event: EventEnvelope<InterferenceEventPayload>,
): Promise<void> => {
  const payload = event.payload;
  const eventTs = new Date(event.occurred_at);

  try {
    await pool.query(
      `insert into ox_interference_events (
         deployment_target, occurred_at, pressure_a_id, pressure_b_id,
         sponsor_a_id, sponsor_b_id, interference_probability, reduction_factor,
         source_event_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (source_event_id) do nothing`,
      [
        payload.deployment_target,
        eventTs,
        payload.pressure_a_id,
        payload.pressure_b_id,
        payload.sponsor_a_id,
        payload.sponsor_b_id,
        payload.interference_probability,
        payload.reduction_factor,
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Interference event projection warning');
  }
};

/**
 * Project pressure decay.
 */
const projectPressureDecayed = async (
  event: EventEnvelope<PressureDecayedPayload>,
): Promise<void> => {
  const payload = event.payload;
  const eventTs = new Date(event.occurred_at);

  try {
    // Add to decay history
    await pool.query(
      `insert into ox_pressure_decay_history (
         pressure_id, sponsor_id, deployment_target, ts,
         original_magnitude, current_magnitude, decay_pct, source_event_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (source_event_id) do nothing`,
      [
        payload.pressure_id,
        payload.sponsor_id,
        payload.deployment_target,
        eventTs,
        payload.original_magnitude,
        payload.current_magnitude,
        payload.decay_pct,
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Pressure decayed projection warning');
  }
};

/**
 * Project pressure expiry.
 */
const projectPressureExpired = async (
  event: EventEnvelope<PressureExpiredPayload>,
): Promise<void> => {
  const payload = event.payload;
  const eventTs = new Date(event.occurred_at);

  try {
    // Update sponsor pressure projection with expired status
    await pool.query(
      `update ox_sponsor_pressures set cancelled_at = $2
       where id = $1 and cancelled_at is null`,
      [payload.pressure_id, eventTs],
    );

    // Add to decay history
    await pool.query(
      `insert into ox_pressure_decay_history (
         pressure_id, sponsor_id, deployment_target, ts,
         original_magnitude, current_magnitude, decay_pct, source_event_id
       ) values ($1, $2, $3, $4, 0, 0, 100, $5)
       on conflict (source_event_id) do nothing`,
      [
        payload.pressure_id,
        payload.sponsor_id,
        payload.deployment_target,
        eventTs,
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Pressure expired projection warning');
  }
};

// ============================================================================
// PHASE 12: Collision Projection Logic
// ============================================================================

interface CollisionEventPayload extends PhysicsEventPayload {
  collision_id: string;
  locality_id: string;
  locality_name: string;
  agent_ids: string[];
  group_size: number;
  tick_id: string;
}

/**
 * Project collision generated event.
 */
const projectCollisionGenerated = async (
  event: EventEnvelope<CollisionEventPayload>,
): Promise<void> => {
  const payload = event.payload;
  const eventTs = new Date(event.occurred_at);

  try {
    // Insert collision event
    await pool.query(
      `insert into ox_collision_events (
         deployment_target, locality_id, locality_name, agent_ids,
         group_size, tick_id, created_at, source_event_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (source_event_id) do nothing`,
      [
        payload.deployment_target,
        payload.locality_id,
        payload.locality_name,
        payload.agent_ids,
        payload.group_size,
        payload.tick_id,
        eventTs,
        event.event_id,
      ],
    );

    // Update locality state
    await pool.query(
      `insert into ox_locality_state (
         deployment_target, locality_id, name, last_collision_at, total_collisions, computed_at
       ) values ($1, $2, $3, $4, 1, $4)
       on conflict (deployment_target, locality_id) do update set
         last_collision_at = $4,
         total_collisions = ox_locality_state.total_collisions + 1,
         computed_at = $4`,
      [
        payload.deployment_target,
        payload.locality_id,
        payload.locality_name,
        eventTs,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Collision projection warning');
  }
};

// ============================================================================
// PHASE 13: Gravity Window Projection Logic
// ============================================================================

interface GravityWindowPayload extends PhysicsEventPayload {
  agent_id: string;
  tick_id: string;
  window_start: string;
  window_end: string;
  emergent_role: string;
  role_strength: number;
  interaction_count: number;
  unique_partners: number;
  dominant_action_type: string;
  gravitation_vector: Record<string, number>;
}

const projectGravityWindow = async (
  event: EventEnvelope<GravityWindowPayload>,
): Promise<void> => {
  const payload = event.payload;

  try {
    await pool.query(
      `insert into ox_agent_gravity_windows (
         agent_id, window_start, window_end, emergent_role, role_strength,
         interaction_count, unique_partners, dominant_action_type, gravitation_vector_json,
         source_event_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (source_event_id) do nothing`,
      [
        payload.agent_id,
        payload.window_start,
        payload.window_end,
        payload.emergent_role,
        payload.role_strength,
        payload.interaction_count,
        payload.unique_partners,
        payload.dominant_action_type,
        JSON.stringify(payload.gravitation_vector),
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Gravity window projection warning');
  }
};

// ============================================================================
// PHASE 14: Conflict Chain Projection Logic
// ============================================================================

interface ConflictChainPayload extends PhysicsEventPayload {
  chain_id: string;
  tick_id: string;
  initiator_agent_id: string;
  responder_agent_ids: string[];
  origin_action_type: string;
  chain_length: number;
  intensity: number;
  status: string;
  started_at: string;
}

const projectConflictChain = async (
  event: EventEnvelope<ConflictChainPayload>,
): Promise<void> => {
  const payload = event.payload;

  try {
    await pool.query(
      `insert into ox_conflict_chains (
         deployment_target, chain_id, initiator_agent_id, responder_agent_ids,
         origin_action_type, chain_length, intensity, status, started_at, source_event_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (source_event_id) do nothing`,
      [
        payload.deployment_target,
        payload.chain_id,
        payload.initiator_agent_id,
        payload.responder_agent_ids,
        payload.origin_action_type,
        payload.chain_length,
        payload.intensity,
        payload.status,
        payload.started_at,
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Conflict chain projection warning');
  }
};

// ============================================================================
// PHASE 16: Silence Window Projection Logic
// ============================================================================

interface SilenceWindowPayload extends PhysicsEventPayload {
  agent_id: string;
  tick_id: string;
  window_start: string;
  trigger_cause: string;
  fatigue_level: number;
  desperation_score: number;
}

const projectSilenceWindow = async (
  event: EventEnvelope<SilenceWindowPayload>,
): Promise<void> => {
  const payload = event.payload;

  try {
    await pool.query(
      `insert into ox_silence_windows (
         deployment_target, agent_id, window_start, trigger_cause,
         fatigue_level, desperation_score, source_event_id
       ) values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (source_event_id) do nothing`,
      [
        payload.deployment_target,
        payload.agent_id,
        payload.window_start,
        payload.trigger_cause,
        payload.fatigue_level,
        payload.desperation_score,
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Silence window projection warning');
  }
};

// ============================================================================
// PHASE 17: Wave Projection Logic
// ============================================================================

interface WavePayload extends PhysicsEventPayload {
  wave_id: string;
  tick_id: string;
  wave_type: string;
  trigger_event_id?: string;
  peak_intensity: number;
  affected_agent_count: number;
  affected_agent_ids: string[];
  started_at: string;
}

const projectWave = async (
  event: EventEnvelope<WavePayload>,
): Promise<void> => {
  const payload = event.payload;

  try {
    await pool.query(
      `insert into ox_waves (
         deployment_target, wave_id, wave_type, trigger_event_id,
         peak_intensity, affected_agent_count, affected_agent_ids, started_at, source_event_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (source_event_id) do nothing`,
      [
        payload.deployment_target,
        payload.wave_id,
        payload.wave_type,
        payload.trigger_event_id,
        payload.peak_intensity,
        payload.affected_agent_count,
        payload.affected_agent_ids,
        payload.started_at,
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Wave projection warning');
  }
};

// ============================================================================
// PHASE 18: Observer Coupling Projection Logic
// ============================================================================

interface ObserverCouplingPayload extends PhysicsEventPayload {
  tick_id: string;
  concurrent_observers: number;
  observer_mass: number;
  coupling_factor: number;
  behavioral_drift_pct: number;
  recent_queries: number;
}

const projectObserverCoupling = async (
  event: EventEnvelope<ObserverCouplingPayload>,
): Promise<void> => {
  const payload = event.payload;
  const eventTs = new Date(event.occurred_at);

  try {
    await pool.query(
      `insert into ox_observer_concurrency (
         deployment_target, ts, concurrent_observers, observer_mass,
         coupling_factor, behavioral_drift_pct, computed_at, source_event_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (source_event_id) do nothing`,
      [
        payload.deployment_target,
        eventTs,
        payload.concurrent_observers,
        payload.observer_mass,
        payload.coupling_factor,
        payload.behavioral_drift_pct,
        eventTs,
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Observer coupling projection warning');
  }
};

// ============================================================================
// PHASE 19: Structure Projection Logic
// ============================================================================

interface StructurePayload extends PhysicsEventPayload {
  structure_id: string;
  tick_id: string;
  structure_type: string;
  name: string;
  member_agent_ids: string[];
  member_count: number;
  formation_trigger: string;
  stability_score: number;
}

const projectStructure = async (
  event: EventEnvelope<StructurePayload>,
): Promise<void> => {
  const payload = event.payload;
  const eventTs = new Date(event.occurred_at);

  try {
    await pool.query(
      `insert into ox_structures (
         deployment_target, structure_id, structure_type, name, member_agent_ids,
         member_count, formation_trigger, stability_score, formed_at, source_event_id
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (source_event_id) do nothing`,
      [
        payload.deployment_target,
        payload.structure_id,
        payload.structure_type,
        payload.name,
        payload.member_agent_ids,
        payload.member_count,
        payload.formation_trigger,
        payload.stability_score,
        eventTs,
        event.event_id,
      ],
    );
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Structure projection warning');
  }
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

  // 7. Axis 2: Environment change projection
  try {
    await projectEnvironmentChange(event);
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Environment change projection warning');
  }

  // 8. Axis 2: Environment rejection projection
  try {
    await projectEnvironmentRejection(event);
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Environment rejection projection warning');
  }

  // 9. Axis 4: Deployment-specific patterns
  try {
    await updateDeploymentPatterns(agentId, deploymentTarget, eventTs, event.event_type, actionType);
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Deployment pattern update warning');
  }

  // 10. Axis 4: Compute drift (periodically, every 100 events or so)
  // This is a heuristic to avoid computing drift on every event
  try {
    const shouldComputeDrift = Math.random() < 0.01; // ~1% of events
    if (shouldComputeDrift && event.event_type.startsWith('agent.action_')) {
      await computeDeploymentDrift(agentId, eventTs);
    }
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Deployment drift computation warning');
  }

  // 11. Phase 7: Sponsor policy events
  try {
    if (event.event_type.startsWith('sponsor.policy_') || event.event_type.includes('sponsor_policy_')) {
      await handleSponsorPolicyEventInline(event);
    }
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Sponsor policy event handling warning');
  }

  // 12. Phase 9: Credit events
  try {
    if (event.event_type.includes('credits_')) {
      await handleCreditEventInline(event);
    }
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Credit event handling warning');
  }

  // 13. Phase 10: Foundry events
  try {
    if (event.event_type === 'agent.foundry_created' ||
        event.event_type === 'agent.config_updated' ||
        event.event_type === 'agent.deployed') {
      await handleFoundryEventInline(event);
    }
  } catch (err) {
    app.log.warn({ err, event_id: event.event_id }, 'Foundry event handling warning');
  }
};

// --- Phase 7-10 Inline Event Handlers ---

const handleSponsorPolicyEventInline = async (event: EventEnvelope<AgentEventPayload>): Promise<void> => {
  const payload = event.payload;
  const eventTs = new Date(event.occurred_at);

  switch (event.event_type) {
    case 'sponsor.policy_created': {
      await pool.query(
        `insert into ox_sponsor_policies (id, sponsor_id, policy_type, cadence_seconds, active, created_at, source_event_id)
         values ($1, $2, $3, $4, true, $5, $6)
         on conflict (source_event_id) do nothing`,
        [payload.policy_id, payload.sponsor_id, payload.policy_type, payload.cadence_seconds, eventTs, event.event_id],
      );
      break;
    }
    case 'sponsor.policy_disabled': {
      await pool.query(`update ox_sponsor_policies set active = false where id = $1`, [payload.policy_id]);
      break;
    }
    case 'agent.sponsor_policy_applied':
    case 'agent.sponsor_policy_skipped': {
      const applied = event.event_type === 'agent.sponsor_policy_applied';
      await pool.query(
        `insert into ox_sponsor_policy_applications
           (policy_id, sponsor_id, agent_id, policy_type, applied, reason, diff_json, applied_at, source_event_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (source_event_id) do nothing`,
        [payload.policy_id, payload.sponsor_id, payload.agent_id, payload.policy_type, applied,
         payload.reason ?? 'policy_applied', JSON.stringify(payload.diff ?? {}), eventTs, event.event_id],
      );
      if (applied) {
        await pool.query(
          `insert into ox_artifacts (artifact_type, source_event_id, agent_id, deployment_target, title, content_summary, metadata_json)
           values ('sweep', $1, $2, $3, $4, $5, $6)
           on conflict (source_event_id, artifact_type) do nothing`,
          [event.event_id, payload.agent_id, payload.deployment_target ?? 'unknown',
           `Sponsor policy ${payload.policy_type} applied`, `Policy ${payload.policy_id} applied`,
           JSON.stringify({ policy_id: payload.policy_id, sponsor_id: payload.sponsor_id, diff: payload.diff })],
        );
      }
      break;
    }
  }
};

const handleCreditEventInline = async (event: EventEnvelope<AgentEventPayload>): Promise<void> => {
  const payload = event.payload;
  const eventTs = new Date(event.occurred_at);

  switch (event.event_type) {
    case 'sponsor.credits_purchased': {
      await pool.query(
        `insert into ox_credit_transactions (ts, sponsor_id, type, amount, balance_after, source_event_id)
         values ($1, $2, 'purchase', $3, $4, $5)
         on conflict (source_event_id) do nothing`,
        [eventTs, payload.sponsor_id, payload.amount, payload.new_balance, event.event_id],
      );
      break;
    }
    case 'agent.credits_allocated': {
      await pool.query(
        `insert into ox_credit_transactions (ts, sponsor_id, agent_id, type, amount, balance_after, source_event_id)
         values ($1, $2, $3, 'allocation', $4, $5, $6)
         on conflict (source_event_id) do nothing`,
        [eventTs, payload.sponsor_id, payload.agent_id, payload.amount, payload.agent_balance, event.event_id],
      );
      break;
    }
  }
};

const handleFoundryEventInline = async (event: EventEnvelope<AgentEventPayload>): Promise<void> => {
  const payload = event.payload;
  const eventTs = new Date(event.occurred_at);

  switch (event.event_type) {
    case 'agent.foundry_created': {
      await pool.query(
        `insert into ox_agent_config_history (agent_id, ts, change_type, changes_json, source_event_id)
         values ($1, $2, 'created', $3, $4)
         on conflict (source_event_id) do nothing`,
        [payload.agent_id, eventTs, JSON.stringify(payload.config ?? {}), event.event_id],
      );
      break;
    }
    case 'agent.config_updated': {
      await pool.query(
        `insert into ox_agent_config_history (agent_id, ts, change_type, changes_json, source_event_id)
         values ($1, $2, 'updated', $3, $4)
         on conflict (source_event_id) do nothing`,
        [payload.agent_id, eventTs, JSON.stringify(payload.changes ?? {}), event.event_id],
      );
      break;
    }
    case 'agent.deployed': {
      await pool.query(
        `insert into ox_agent_config_history (agent_id, ts, change_type, changes_json, source_event_id)
         values ($1, $2, 'deployed', $3, $4)
         on conflict (source_event_id) do nothing`,
        [payload.agent_id, eventTs, JSON.stringify({
          previous_deployment_target: payload.previous_deployment_target,
          new_deployment_target: payload.new_deployment_target,
        }), event.event_id],
      );
      break;
    }
  }
};

// --- Start consumer ---

const startConsumer = async () => {
  try {
    // Consumer for agent events (with Phase 7-10 support integrated)
    await runConsumer({
      groupId: 'ox-read-materializer',
      topics: ['events.agents.v1'],
      handler: handleEvent,
      dlq: true,
    });
    app.log.info('OX Read consumer started for events.agents.v1');

    // Consumer for physics events (Phase 6)
    await runConsumer({
      groupId: 'ox-read-physics-materializer',
      topics: ['events.ox-physics.v1'],
      handler: handlePhysicsEvent,
      dlq: true,
    });
    app.log.info('OX Read consumer started for events.ox-physics.v1');

    consumerInitialized = true;
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
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, ts, type, agent_id, deployment_target, action_type, session_id, summary_json as summary
     from ox_live_events
     order by ts desc
     limit $1`,
    [limit],
  );

  // Log observer access with role (Axis 3)
  await logObserverAccess('/ox/live', query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

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
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

  const res = await pool.query(
    `select session_id, start_ts, end_ts, participating_agent_ids, deployment_target,
            derived_topic, event_count, is_active
     from ox_sessions
     order by start_ts desc
     limit $1`,
    [limit],
  );

  // Log observer access with role
  await logObserverAccess('/ox/sessions', query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

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
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

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

  // Log observer access with role
  await logObserverAccess(`/ox/sessions/${id}`, {}, eventsRes.rowCount ?? 0, observerId, observerRole);

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

// --- Read-only API: Artifacts (Phase C + Axis 1) ---

interface ArtifactsQueryParams {
  session_id?: string;
  agent_id?: string;
  artifact_type?: string;
  subject_agent_id?: string; // Axis 1: Filter by subject
  limit?: string;
}

app.get('/ox/artifacts', {
  preHandler: rateLimitMiddleware(RATE_LIMIT_CONFIG.artifacts),
}, async (request) => {
  const query = request.query as ArtifactsQueryParams;
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  let sql = `
    select id, artifact_type, source_session_id, source_event_id, agent_id, deployment_target,
           title, content_summary, metadata_json as metadata, subject_agent_id, created_at
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
  // Axis 1: Filter by subject agent
  if (query.subject_agent_id) {
    sql += ` and subject_agent_id = $${paramIndex++}`;
    params.push(query.subject_agent_id);
  }

  sql += ` order by created_at desc limit $${paramIndex}`;
  params.push(limit);

  const res = await pool.query(sql, params);

  // Log observer access with role (Axis 3)
  await logObserverAccess('/ox/artifacts', query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    artifacts: res.rows.map((row) => ({
      id: row.id,
      artifact_type: row.artifact_type,
      source_session_id: row.source_session_id,
      source_event_id: row.source_event_id,
      agent_id: row.agent_id,
      subject_agent_id: row.subject_agent_id,
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
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  const res = await pool.query(
    `select id, artifact_type, source_session_id, source_event_id, agent_id, deployment_target,
            title, content_summary, metadata_json as metadata, subject_agent_id, created_at
     from ox_artifacts
     where id = $1`,
    [id],
  );

  // Log observer access with role
  await logObserverAccess(`/ox/artifacts/${id}`, {}, res.rowCount ?? 0, observerId, observerRole);

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
      subject_agent_id: row.subject_agent_id,
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
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/agents')) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

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

  // Log observer access with role
  await logObserverAccess(`/ox/agents/${id}/economics`, { hours }, timelineRes.rowCount ?? 0, observerId, observerRole);

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

app.get('/ox/system/throughput', async (request, reply) => {
  const query = request.query as { hours?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/system')) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

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

  await logObserverAccess('/ox/system/throughput', { hours }, 1, observerId, observerRole);

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

app.get('/ox/system/event-lag', async (request, reply) => {
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/system')) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

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

  await logObserverAccess('/ox/system/event-lag', {}, res.rowCount ?? 0, observerId, observerRole);

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

app.get('/ox/system/projection-health', async (request, reply) => {
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/system')) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

  // Get counts from all projection tables
  const [liveRes, sessionsRes, patternsRes, artifactsRes, timelineRes, accessRes] = await Promise.all([
    pool.query('select count(*) as count from ox_live_events'),
    pool.query('select count(*) as count, count(*) filter (where is_active) as active from ox_sessions'),
    pool.query('select count(*) as count from ox_agent_patterns'),
    pool.query('select count(*) as count from ox_artifacts'),
    pool.query('select count(*) as count from ox_capacity_timeline'),
    pool.query('select count(*) as count from observer_access_log where accessed_at > now() - interval \'1 hour\''),
  ]);

  await logObserverAccess('/ox/system/projection-health', {}, 1, observerId, observerRole);

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

// --- Axis 1: Inter-Agent Perception Endpoints ---

// Get artifacts where an agent is the subject (perceived by others)
app.get('/ox/agents/:id/perceived-by', async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, `/ox/agents/${id}/perceived-by`)) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select a.id, a.artifact_type, a.agent_id as issuing_agent_id, a.title, a.content_summary,
            a.metadata_json as metadata, a.created_at,
            i.implication_type
     from ox_artifacts a
     join ox_artifact_implications i on i.artifact_id = a.id
     where i.subject_agent_id = $1
     order by a.created_at desc
     limit $2`,
    [id, limit],
  );

  await logObserverAccess(`/ox/agents/${id}/perceived-by`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    subject_agent_id: id,
    perceptions: res.rows.map((row) => ({
      artifact_id: row.id,
      artifact_type: row.artifact_type,
      issuing_agent_id: row.issuing_agent_id,
      implication_type: row.implication_type,
      title: row.title,
      content_summary: row.content_summary,
      metadata: row.metadata,
      created_at: row.created_at,
    })),
  };
});

// Get artifacts an agent has issued about others
app.get('/ox/agents/:id/perceptions-issued', async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, `/ox/agents/${id}/perceptions-issued`)) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select a.id, a.artifact_type, a.subject_agent_id, a.title, a.content_summary,
            a.metadata_json as metadata, a.created_at,
            i.implication_type
     from ox_artifacts a
     join ox_artifact_implications i on i.artifact_id = a.id
     where i.issuing_agent_id = $1
     order by a.created_at desc
     limit $2`,
    [id, limit],
  );

  await logObserverAccess(`/ox/agents/${id}/perceptions-issued`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    issuing_agent_id: id,
    perceptions: res.rows.map((row) => ({
      artifact_id: row.id,
      artifact_type: row.artifact_type,
      subject_agent_id: row.subject_agent_id,
      implication_type: row.implication_type,
      title: row.title,
      content_summary: row.content_summary,
      metadata: row.metadata,
      created_at: row.created_at,
    })),
  };
});

// --- Axis 2: Environment State Endpoints ---

app.get('/ox/environment', async (request, reply) => {
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/environment')) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

  const res = await pool.query(
    `select deployment_target, cognition_availability, max_throughput_per_minute,
            throttle_factor, active_window_start, active_window_end, imposed_at, reason
     from ox_environment_states
     order by deployment_target`,
  );

  await logObserverAccess('/ox/environment', {}, res.rowCount ?? 0, observerId, observerRole);

  return { environment_states: res.rows };
});

app.get('/ox/environment/:target/history', async (request, reply) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/environment')) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, previous_state_json, new_state_json, change_type, source_event_id, changed_at
     from ox_environment_history
     where deployment_target = $1
     order by changed_at desc
     limit $2`,
    [target, limit],
  );

  await logObserverAccess(`/ox/environment/${target}/history`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    deployment_target: target,
    history: res.rows.map((row) => ({
      id: row.id,
      previous_state: row.previous_state_json,
      new_state: row.new_state_json,
      change_type: row.change_type,
      source_event_id: row.source_event_id,
      changed_at: row.changed_at,
    })),
  };
});

app.get('/ox/environment/:target/rejections', async (request, reply) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string; agent_id?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/environment')) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  let sql = `
    select id, agent_id, rejection_reason, environment_state_json, source_event_id, rejected_at
    from ox_environment_rejections
    where deployment_target = $1
  `;
  const params: unknown[] = [target];
  let paramIndex = 2;

  if (query.agent_id) {
    sql += ` and agent_id = $${paramIndex++}`;
    params.push(query.agent_id);
  }

  sql += ` order by rejected_at desc limit $${paramIndex}`;
  params.push(limit);

  const res = await pool.query(sql, params);

  await logObserverAccess(`/ox/environment/${target}/rejections`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    deployment_target: target,
    rejections: res.rows.map((row) => ({
      id: row.id,
      agent_id: row.agent_id,
      rejection_reason: row.rejection_reason,
      environment_state: row.environment_state_json,
      source_event_id: row.source_event_id,
      rejected_at: row.rejected_at,
    })),
  };
});

// --- Phase 6: World State Endpoints ---

// Get all current world states
app.get('/ox/world', async (request) => {
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  const res = await pool.query(
    `select deployment_target, regime_name, weather_state, vars_json, updated_at
     from ox_world_state
     order by deployment_target`,
  );

  await logObserverAccess('/ox/world', {}, res.rowCount ?? 0, observerId, observerRole);

  // Apply observer role gating
  // Viewer: summary only (regime, weather, no vars_json)
  // Analyst: + vars_json
  // Auditor: everything
  return {
    world_states: res.rows.map((row) => {
      const base = {
        deployment_target: row.deployment_target,
        regime_name: row.regime_name,
        weather_state: row.weather_state,
        updated_at: row.updated_at,
      };

      if (observerRole === 'viewer') {
        return base;
      }

      return {
        ...base,
        vars: row.vars_json,
      };
    }),
  };
});

// Get world state for a specific deployment target
app.get('/ox/world/:target', async (request, reply) => {
  const { target } = request.params as { target: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  const res = await pool.query(
    `select deployment_target, regime_name, weather_state, vars_json, updated_at, source_event_id
     from ox_world_state
     where deployment_target = $1`,
    [target],
  );

  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'world state not found for deployment target' };
  }

  await logObserverAccess(`/ox/world/${target}`, {}, 1, observerId, observerRole);

  const row = res.rows[0];

  // Apply observer role gating
  const base = {
    deployment_target: row.deployment_target,
    regime_name: row.regime_name,
    weather_state: row.weather_state,
    updated_at: row.updated_at,
  };

  if (observerRole === 'viewer') {
    return { world_state: base };
  }

  const analystView = {
    ...base,
    vars: row.vars_json,
  };

  if (observerRole === 'analyst') {
    return { world_state: analystView };
  }

  // Auditor gets source_event_id
  return {
    world_state: {
      ...analystView,
      source_event_id: row.source_event_id,
    },
  };
});

// Get world state history for a deployment target
app.get('/ox/world/:target/history', async (request, reply) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  // History requires at least analyst role
  if (observerRole === 'viewer') {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, ts, regime_name, weather_state, vars_json, reason, source_event_id
     from ox_world_state_history
     where deployment_target = $1
     order by ts desc
     limit $2`,
    [target, limit],
  );

  await logObserverAccess(`/ox/world/${target}/history`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    deployment_target: target,
    history: res.rows.map((row) => {
      const base = {
        id: row.id,
        ts: row.ts,
        regime_name: row.regime_name,
        weather_state: row.weather_state,
        vars: row.vars_json,
        reason: row.reason,
      };

      // Auditor gets source_event_id
      if (observerRole === 'auditor') {
        return { ...base, source_event_id: row.source_event_id };
      }

      return base;
    }),
  };
});

// Get rolling effects for a deployment target
app.get('/ox/world/:target/effects', async (request, reply) => {
  const { target } = request.params as { target: string };
  const query = request.query as { hours?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  // Effects require at least analyst role
  if (observerRole === 'viewer') {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const hours = Math.min(Math.max(Number(query.hours) || 6, 1), 168); // Max 1 week
  const windowStart = new Date(Date.now() - hours * 60 * 60 * 1000);

  const res = await pool.query(
    `select bucket_start, accepted_count, rejected_count, sessions_created, artifacts_created,
            cognition_provider_counts, avg_requested_cost, p95_latency_ms
     from ox_world_effects_5m
     where deployment_target = $1 and bucket_start >= $2
     order by bucket_start desc`,
    [target, windowStart],
  );

  await logObserverAccess(`/ox/world/${target}/effects`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  // Compute aggregates
  let totalAccepted = 0;
  let totalRejected = 0;
  let totalSessions = 0;
  let totalArtifacts = 0;

  for (const row of res.rows) {
    totalAccepted += Number(row.accepted_count ?? 0);
    totalRejected += Number(row.rejected_count ?? 0);
    totalSessions += Number(row.sessions_created ?? 0);
    totalArtifacts += Number(row.artifacts_created ?? 0);
  }

  return {
    deployment_target: target,
    window_hours: hours,
    aggregates: {
      total_accepted: totalAccepted,
      total_rejected: totalRejected,
      total_sessions: totalSessions,
      total_artifacts: totalArtifacts,
      bucket_count: res.rowCount ?? 0,
    },
    buckets: res.rows.map((row) => ({
      bucket_start: row.bucket_start,
      accepted_count: Number(row.accepted_count),
      rejected_count: Number(row.rejected_count),
      sessions_created: Number(row.sessions_created),
      artifacts_created: Number(row.artifacts_created),
      cognition_provider_counts: row.cognition_provider_counts,
      avg_requested_cost: row.avg_requested_cost ? Number(row.avg_requested_cost) : null,
      p95_latency_ms: row.p95_latency_ms,
    })),
  };
});

// --- Axis 3: Observer Self-Inspection Endpoints ---

// Observer self-registration
app.post('/ox/observers/register', async (request) => {
  const body = request.body as { observer_id: string; role?: string; metadata?: Record<string, unknown> };
  const observerId = body.observer_id;

  // Validate role
  let role: ObserverRole = 'viewer';
  if (body.role && OBSERVER_ROLES.includes(body.role as ObserverRole)) {
    role = body.role as ObserverRole;
  }

  await pool.query(
    `insert into ox_observers (observer_id, observer_role, metadata_json)
     values ($1, $2::observer_role, $3)
     on conflict (observer_id)
     do update set observer_role = $2::observer_role, metadata_json = $3, last_seen_at = now()`,
    [observerId, role, JSON.stringify(body.metadata ?? {})],
  );

  return {
    ok: true,
    observer_id: observerId,
    observer_role: role,
  };
});

// Observer self-inspection
app.get('/ox/observers/me', async (request, reply) => {
  const observerId = request.headers['x-observer-id'] as string | undefined;

  if (!observerId) {
    reply.status(400);
    return { error: 'x-observer-id header required' };
  }

  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/observers')) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

  const res = await pool.query(
    `select observer_id, observer_role, registered_at, last_seen_at, access_count, metadata_json
     from ox_observers
     where observer_id = $1`,
    [observerId],
  );

  // Get recent access log
  const accessRes = await pool.query(
    `select endpoint, query_params_json, response_count, accessed_at
     from observer_access_log
     where observer_id = $1
     order by accessed_at desc
     limit 20`,
    [observerId],
  );

  await logObserverAccess('/ox/observers/me', {}, 1, observerId, observerRole);

  if (res.rowCount === 0) {
    return {
      observer_id: observerId,
      registered: false,
      observer_role: observerRole,
      recent_access: accessRes.rows,
    };
  }

  const row = res.rows[0];
  return {
    observer_id: row.observer_id,
    registered: true,
    observer_role: row.observer_role,
    registered_at: row.registered_at,
    last_seen_at: row.last_seen_at,
    access_count: row.access_count,
    metadata: row.metadata_json,
    recent_access: accessRes.rows,
  };
});

// List all observers (auditor only)
app.get('/ox/observers', async (request, reply) => {
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/observers')) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select observer_id, observer_role, registered_at, last_seen_at, access_count
     from ox_observers
     order by last_seen_at desc
     limit $1`,
    [limit],
  );

  await logObserverAccess('/ox/observers', query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { observers: res.rows };
});

// --- Axis 4: Deployment Drift Endpoints ---

// Get deployment patterns for an agent
app.get('/ox/agents/:id/deployment-patterns', async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = request.query as { deployment_target?: string; limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/drift')) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

  let sql = `
    select deployment_target, pattern_type, window_start, window_end, observation_json, event_count, created_at
    from ox_agent_deployment_patterns
    where agent_id = $1
  `;
  const params: unknown[] = [id];
  let paramIndex = 2;

  if (query.deployment_target) {
    sql += ` and deployment_target = $${paramIndex++}`;
    params.push(query.deployment_target);
  }

  sql += ` order by window_end desc limit $${paramIndex}`;
  params.push(limit);

  const res = await pool.query(sql, params);

  await logObserverAccess(`/ox/agents/${id}/deployment-patterns`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    agent_id: id,
    patterns: res.rows.map((row) => ({
      deployment_target: row.deployment_target,
      pattern_type: row.pattern_type,
      window_start: row.window_start,
      window_end: row.window_end,
      observation: row.observation_json,
      event_count: row.event_count,
      created_at: row.created_at,
    })),
  };
});

// Get drift observations for an agent
app.get('/ox/agents/:id/drift', async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/drift')) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

  const res = await pool.query(
    `select id, deployment_a, deployment_b, pattern_type, window_end, drift_summary_json, created_at
     from ox_deployment_drift
     where agent_id = $1
     order by window_end desc
     limit $2`,
    [id, limit],
  );

  await logObserverAccess(`/ox/agents/${id}/drift`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    agent_id: id,
    drift_observations: res.rows.map((row) => ({
      id: row.id,
      deployment_a: row.deployment_a,
      deployment_b: row.deployment_b,
      pattern_type: row.pattern_type,
      window_end: row.window_end,
      drift_summary: row.drift_summary_json,
      created_at: row.created_at,
    })),
  };
});

// System-wide drift summary (auditor only)
app.get('/ox/drift/summary', async (request, reply) => {
  const query = request.query as { hours?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/drift')) {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

  const hours = Math.min(Math.max(Number(query.hours) || 24, 1), 168);
  const windowStart = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Get agents with drift observations
  const res = await pool.query(
    `select d.agent_id, count(distinct d.id) as drift_count,
            array_agg(distinct d.deployment_a) || array_agg(distinct d.deployment_b) as deployments
     from ox_deployment_drift d
     where d.created_at >= $1
     group by d.agent_id
     order by drift_count desc
     limit 50`,
    [windowStart],
  );

  // Get deployment target counts
  const deploymentRes = await pool.query(
    `select deployment_target, count(distinct agent_id) as agent_count
     from ox_agent_deployment_patterns
     where created_at >= $1
     group by deployment_target
     order by agent_count desc`,
    [windowStart],
  );

  await logObserverAccess('/ox/drift/summary', query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    window_hours: hours,
    agents_with_drift: res.rows.map((row) => ({
      agent_id: row.agent_id,
      drift_observation_count: Number(row.drift_count),
      deployments: [...new Set(row.deployments.filter(Boolean))],
    })),
    deployments: deploymentRes.rows.map((row) => ({
      deployment_target: row.deployment_target,
      agent_count: Number(row.agent_count),
    })),
  };
});

// --- Phase 7: Sponsor Policy Endpoints (analyst+) ---

app.get('/ox/sponsors/:id/policies', async (request, reply) => {
  const { id } = request.params as { id: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/artifacts')) { // analyst+ required
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const res = await pool.query(
    `select id, sponsor_id, policy_type, cadence_seconds, active, created_at
     from ox_sponsor_policies
     where sponsor_id = $1
     order by created_at desc`,
    [id],
  );

  await logObserverAccess(`/ox/sponsors/${id}/policies`, {}, res.rowCount ?? 0, observerId, observerRole);

  return { policies: res.rows };
});

app.get('/ox/sponsors/:id/policy-runs', async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/artifacts')) { // analyst+ required
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, policy_id, sponsor_id, agent_id, policy_type, applied, reason, diff_json, applied_at
     from ox_sponsor_policy_applications
     where sponsor_id = $1
     order by applied_at desc
     limit $2`,
    [id, limit],
  );

  await logObserverAccess(`/ox/sponsors/${id}/policy-runs`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    policy_applications: res.rows.map((row) => ({
      id: row.id,
      policy_id: row.policy_id,
      sponsor_id: row.sponsor_id,
      agent_id: row.agent_id,
      policy_type: row.policy_type,
      applied: row.applied,
      reason: row.reason,
      diff: row.diff_json,
      applied_at: row.applied_at,
    })),
  };
});

// --- Phase 9: Credit Endpoints (analyst+) ---

app.get('/ox/agents/:id/credits', async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/artifacts')) { // analyst+ required
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, ts, sponsor_id, type, amount, balance_after
     from ox_credit_transactions
     where agent_id = $1
     order by ts desc
     limit $2`,
    [id, limit],
  );

  await logObserverAccess(`/ox/agents/${id}/credits`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { transactions: res.rows };
});

app.get('/ox/sponsors/:id/credits', async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/drift')) { // auditor required
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, ts, agent_id, type, amount, balance_after
     from ox_credit_transactions
     where sponsor_id = $1
     order by ts desc
     limit $2`,
    [id, limit],
  );

  await logObserverAccess(`/ox/sponsors/${id}/credits`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { transactions: res.rows };
});

app.get('/ox/credit-requests', async (request, reply) => {
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/artifacts')) { // analyst+ required
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  // Find artifacts that are credit requests
  const res = await pool.query(
    `select id, agent_id, deployment_target, title, content_summary, metadata_json, created_at
     from ox_artifacts
     where artifact_type = 'request_credits'
     order by created_at desc
     limit $1`,
    [limit],
  );

  await logObserverAccess('/ox/credit-requests', query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    requests: res.rows.map((row) => ({
      id: row.id,
      agent_id: row.agent_id,
      deployment_target: row.deployment_target,
      title: row.title,
      summary: row.content_summary,
      metadata: row.metadata_json,
      created_at: row.created_at,
    })),
  };
});

// --- Phase 10: Agent Config History Endpoint (analyst+) ---

app.get('/ox/agents/:id/config-history', async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!canAccessEndpoint(observerRole, '/ox/artifacts')) { // analyst+ required
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, ts, change_type, changes_json
     from ox_agent_config_history
     where agent_id = $1
     order by ts desc
     limit $2`,
    [id, limit],
  );

  await logObserverAccess(`/ox/agents/${id}/config-history`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    agent_id: id,
    history: res.rows.map((row) => ({
      id: row.id,
      ts: row.ts,
      change_type: row.change_type,
      changes: row.changes_json,
    })),
  };
});

// ============================================================================
// PHASE 11: Sponsor Braids & Pressure Endpoints
// Role-gated visibility: Viewer sees intensity, Analyst sees types, Auditor sees all
// ============================================================================

// Get braids for a deployment target
app.get('/ox/deployments/:target/braids', async (request) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

  const res = await pool.query(
    `select id, deployment_target, computed_at, braid_vector_json,
            total_intensity, active_pressure_count
     from ox_pressure_braids
     where deployment_target = $1
     order by computed_at desc
     limit $2`,
    [target, limit],
  );

  await logObserverAccess(`/ox/deployments/${target}/braids`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  // Role-based visibility
  const braids = res.rows.map((row) => {
    const braid: Record<string, unknown> = {
      id: row.id,
      deployment_target: row.deployment_target,
      computed_at: row.computed_at,
      total_intensity: row.total_intensity,
      active_pressure_count: row.active_pressure_count,
    };

    // Analyst+: Include pressure types breakdown
    if (observerRole === 'analyst' || observerRole === 'auditor') {
      braid.braid_vector = row.braid_vector_json;
    }

    return braid;
  });

  return { deployment_target: target, braids };
});

// Get pressure history for a deployment (analyst+)
app.get('/ox/deployments/:target/pressure-history', async (request, reply) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (observerRole !== 'analyst' && observerRole !== 'auditor') {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, pressure_id, sponsor_id, ts, original_magnitude, current_magnitude, decay_pct
     from ox_pressure_decay_history
     where deployment_target = $1
     order by ts desc
     limit $2`,
    [target, limit],
  );

  await logObserverAccess(`/ox/deployments/${target}/pressure-history`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  // Auditor sees sponsor_ids, analyst does not
  const history = res.rows.map((row) => {
    const entry: Record<string, unknown> = {
      id: row.id,
      pressure_id: row.pressure_id,
      ts: row.ts,
      original_magnitude: row.original_magnitude,
      current_magnitude: row.current_magnitude,
      decay_pct: row.decay_pct,
    };

    if (observerRole === 'auditor') {
      entry.sponsor_id = row.sponsor_id;
    }

    return entry;
  });

  return { deployment_target: target, history };
});

// Get sponsor pressures (auditor only)
app.get('/ox/sponsors/:id/pressures', async (request, reply) => {
  const { id } = request.params as { id: string };
  const query = request.query as { limit?: string; include_expired?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (observerRole !== 'auditor') {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const includeExpired = query.include_expired === 'true';

  let sql = `
    select id, sponsor_id, target_deployment, target_agent_id, pressure_type,
           magnitude, half_life_seconds, created_at, expires_at, cancelled_at, credit_cost
    from ox_sponsor_pressures
    where sponsor_id = $1
  `;
  const params: unknown[] = [id];

  if (!includeExpired) {
    sql += ` and expires_at > now() and cancelled_at is null`;
  }

  sql += ` order by created_at desc limit $2`;
  params.push(limit);

  const res = await pool.query(sql, params);

  await logObserverAccess(`/ox/sponsors/${id}/pressures`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { sponsor_id: id, pressures: res.rows };
});

// Get interference events for a deployment (analyst+)
app.get('/ox/deployments/:target/interference', async (request, reply) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (observerRole !== 'analyst' && observerRole !== 'auditor') {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, deployment_target, occurred_at, pressure_a_id, pressure_b_id,
            sponsor_a_id, sponsor_b_id, interference_probability, reduction_factor
     from ox_interference_events
     where deployment_target = $1
     order by occurred_at desc
     limit $2`,
    [target, limit],
  );

  await logObserverAccess(`/ox/deployments/${target}/interference`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  // Auditor sees sponsor_ids, analyst does not
  const events = res.rows.map((row) => {
    const entry: Record<string, unknown> = {
      id: row.id,
      deployment_target: row.deployment_target,
      occurred_at: row.occurred_at,
      pressure_a_id: row.pressure_a_id,
      pressure_b_id: row.pressure_b_id,
      interference_probability: row.interference_probability,
      reduction_factor: row.reduction_factor,
    };

    if (observerRole === 'auditor') {
      entry.sponsor_a_id = row.sponsor_a_id;
      entry.sponsor_b_id = row.sponsor_b_id;
    }

    return entry;
  });

  return { deployment_target: target, interference_events: events };
});

// ============================================================================
// PHASE 12: Locality Fields & Collision Mechanics Endpoints
// ============================================================================

// Get locality state for a deployment
app.get('/ox/deployments/:target/localities', async (request) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

  const res = await pool.query(
    `select id, deployment_target, locality_id, name, density, interference_density,
            member_count, last_collision_at, total_collisions, computed_at
     from ox_locality_state
     where deployment_target = $1
     order by computed_at desc
     limit $2`,
    [target, limit],
  );

  await logObserverAccess(`/ox/deployments/${target}/localities`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { deployment_target: target, localities: res.rows };
});

// Get collisions for a deployment (analyst+)
app.get('/ox/deployments/:target/collisions', async (request, reply) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (observerRole !== 'analyst' && observerRole !== 'auditor') {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, deployment_target, locality_id, locality_name, agent_ids,
            group_size, tick_id, created_at
     from ox_collision_events
     where deployment_target = $1
     order by created_at desc
     limit $2`,
    [target, limit],
  );

  await logObserverAccess(`/ox/deployments/${target}/collisions`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { deployment_target: target, collisions: res.rows };
});

// ============================================================================
// PHASE 13: Emergent Roles & Social Gravity Endpoints
// ============================================================================

// Get agent gravity windows (interaction patterns)
app.get('/ox/agents/:agentId/gravity', async (request) => {
  const { agentId } = request.params as { agentId: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

  const res = await pool.query(
    `select id, agent_id, window_start, window_end, emergent_role, role_strength,
            interaction_count, unique_partners, dominant_action_type, gravitation_vector_json
     from ox_agent_gravity_windows
     where agent_id = $1
     order by window_end desc
     limit $2`,
    [agentId, limit],
  );

  await logObserverAccess(`/ox/agents/${agentId}/gravity`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { agent_id: agentId, gravity_windows: res.rows };
});

// ============================================================================
// PHASE 14: Conflict Chains, Fracture & Schism Endpoints
// ============================================================================

// Get conflict chains for a deployment (analyst+)
app.get('/ox/deployments/:target/conflict-chains', async (request, reply) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string; status?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (observerRole !== 'analyst' && observerRole !== 'auditor') {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  let sql = `
    select id, deployment_target, chain_id, initiator_agent_id, responder_agent_ids,
           origin_action_type, chain_length, intensity, status, started_at, ended_at
    from ox_conflict_chains
    where deployment_target = $1
  `;
  const params: unknown[] = [target];

  if (query.status) {
    sql += ` and status = $2`;
    params.push(query.status);
  }

  sql += ` order by started_at desc limit $${params.length + 1}`;
  params.push(limit);

  const res = await pool.query(sql, params);

  await logObserverAccess(`/ox/deployments/${target}/conflict-chains`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { deployment_target: target, conflict_chains: res.rows };
});

// ============================================================================
// PHASE 15: Myth Lineages & Distortion Endpoints
// ============================================================================

// Get myth lineages for a deployment
app.get('/ox/deployments/:target/myths', async (request) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

  const res = await pool.query(
    `select id, deployment_target, myth_id, origin_agent_id, origin_content_hash,
            propagation_count, distortion_level, current_content_hash, carrier_agent_ids,
            created_at, last_propagation_at
     from ox_myth_lineages
     where deployment_target = $1
     order by last_propagation_at desc nulls last
     limit $2`,
    [target, limit],
  );

  await logObserverAccess(`/ox/deployments/${target}/myths`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  // Auditor sees agent IDs, others see counts only
  const myths = res.rows.map((row) => {
    const myth: Record<string, unknown> = {
      id: row.id,
      deployment_target: row.deployment_target,
      myth_id: row.myth_id,
      propagation_count: row.propagation_count,
      distortion_level: row.distortion_level,
      created_at: row.created_at,
      last_propagation_at: row.last_propagation_at,
    };

    if (observerRole === 'auditor') {
      myth.origin_agent_id = row.origin_agent_id;
      myth.carrier_agent_ids = row.carrier_agent_ids;
    }

    return myth;
  });

  return { deployment_target: target, myths };
});

// ============================================================================
// PHASE 16: Fatigue, Silence & Desperation Endpoints
// ============================================================================

// Get silence windows for a deployment (analyst+)
app.get('/ox/deployments/:target/silence', async (request, reply) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string; active?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (observerRole !== 'analyst' && observerRole !== 'auditor') {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const activeOnly = query.active === 'true';

  let sql = `
    select id, deployment_target, agent_id, window_start, window_end,
           trigger_cause, fatigue_level, desperation_score
    from ox_silence_windows
    where deployment_target = $1
  `;
  const params: unknown[] = [target];

  if (activeOnly) {
    sql += ` and window_end is null`;
  }

  sql += ` order by window_start desc limit $${params.length + 1}`;
  params.push(limit);

  const res = await pool.query(sql, params);

  await logObserverAccess(`/ox/deployments/${target}/silence`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { deployment_target: target, silence_windows: res.rows };
});

// ============================================================================
// PHASE 17: Flash Phenomena & Waves Endpoints
// ============================================================================

// Get waves for a deployment
app.get('/ox/deployments/:target/waves', async (request) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string; type?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

  let sql = `
    select id, deployment_target, wave_id, wave_type, trigger_event_id,
           peak_intensity, affected_agent_count, affected_agent_ids,
           started_at, peaked_at, ended_at, duration_ms
    from ox_waves
    where deployment_target = $1
  `;
  const params: unknown[] = [target];

  if (query.type) {
    sql += ` and wave_type = $2`;
    params.push(query.type);
  }

  sql += ` order by started_at desc limit $${params.length + 1}`;
  params.push(limit);

  const res = await pool.query(sql, params);

  await logObserverAccess(`/ox/deployments/${target}/waves`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  // Auditor sees affected agent IDs, others see counts only
  const waves = res.rows.map((row) => {
    const wave: Record<string, unknown> = {
      id: row.id,
      deployment_target: row.deployment_target,
      wave_id: row.wave_id,
      wave_type: row.wave_type,
      peak_intensity: row.peak_intensity,
      affected_agent_count: row.affected_agent_count,
      started_at: row.started_at,
      peaked_at: row.peaked_at,
      ended_at: row.ended_at,
      duration_ms: row.duration_ms,
    };

    if (observerRole === 'auditor') {
      wave.affected_agent_ids = row.affected_agent_ids;
      wave.trigger_event_id = row.trigger_event_id;
    }

    return wave;
  });

  return { deployment_target: target, waves };
});

// ============================================================================
// PHASE 18: Observer Mass Coupling Endpoints
// ============================================================================

// Get observer concurrency metrics for a deployment
app.get('/ox/deployments/:target/observer-concurrency', async (request, reply) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (observerRole !== 'analyst' && observerRole !== 'auditor') {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select id, deployment_target, ts, concurrent_observers, observer_mass,
            coupling_factor, behavioral_drift_pct, computed_at
     from ox_observer_concurrency
     where deployment_target = $1
     order by ts desc
     limit $2`,
    [target, limit],
  );

  await logObserverAccess(`/ox/deployments/${target}/observer-concurrency`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { deployment_target: target, concurrency_metrics: res.rows };
});

// ============================================================================
// PHASE 19: Civilization Structures Endpoints
// ============================================================================

// Get structures for a deployment (analyst+)
app.get('/ox/deployments/:target/structures', async (request, reply) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string; type?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (observerRole !== 'analyst' && observerRole !== 'auditor') {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'analyst' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  let sql = `
    select id, deployment_target, structure_id, structure_type, name,
           member_agent_ids, member_count, formation_trigger, stability_score,
           formed_at, dissolved_at
    from ox_structures
    where deployment_target = $1
  `;
  const params: unknown[] = [target];

  if (query.type) {
    sql += ` and structure_type = $2`;
    params.push(query.type);
  }

  sql += ` order by formed_at desc limit $${params.length + 1}`;
  params.push(limit);

  const res = await pool.query(sql, params);

  await logObserverAccess(`/ox/deployments/${target}/structures`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { deployment_target: target, structures: res.rows };
});

// ============================================================================
// PHASE 20: World Forks & Resets Endpoints
// ============================================================================

// Get world snapshots for a deployment (auditor only)
app.get('/ox/deployments/:target/world-snapshots', async (request, reply) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (observerRole !== 'auditor') {
    reply.status(403);
    return { error: 'insufficient observer role', required: 'auditor' };
  }

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

  const res = await pool.query(
    `select id, deployment_target, world_id, epoch_number, snapshot_type,
            agent_count, event_count, snapshot_hash, created_at, created_by
     from ox_world_snapshots
     where deployment_target = $1
     order by created_at desc
     limit $2`,
    [target, limit],
  );

  await logObserverAccess(`/ox/deployments/${target}/world-snapshots`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { deployment_target: target, snapshots: res.rows };
});

// ============================================================================
// PHASE 21: Observer Lens & Narrative Projection
// ============================================================================

const FRAME_TYPES = ['emergence', 'convergence', 'divergence', 'conflict', 'propagation', 'collapse', 'silence'] as const;
type FrameType = typeof FRAME_TYPES[number];

interface NarrativeEvidence {
  artifact_ids?: string[];
  session_ids?: string[];
  agent_ids?: string[];
  conflict_chain_ids?: string[];
  wave_ids?: string[];
  structure_ids?: string[];
}

/**
 * Compute narrative frames for a deployment on rolling windows.
 * Called periodically or on demand.
 */
async function computeNarrativeFrames(
  deploymentTarget: string,
  windowMinutes: number = 5,
): Promise<void> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - windowMinutes * 60 * 1000);
  const frameId = `frame-${deploymentTarget}-${windowEnd.getTime()}`;

  // Collect evidence from various projections
  const [artifacts, sessions, conflicts, waves, structures, silence] = await Promise.all([
    // New artifacts
    pool.query(
      `select id from ox_artifacts where deployment_target = $1 and created_at between $2 and $3`,
      [deploymentTarget, windowStart, windowEnd],
    ),
    // Active sessions
    pool.query(
      `select id from ox_sessions where deployment_target = $1 and started_at between $2 and $3`,
      [deploymentTarget, windowStart, windowEnd],
    ),
    // Conflict chains
    pool.query(
      `select chain_id from ox_conflict_chains where deployment_target = $1 and started_at between $2 and $3`,
      [deploymentTarget, windowStart, windowEnd],
    ),
    // Waves
    pool.query(
      `select wave_id from ox_waves where deployment_target = $1 and started_at between $2 and $3`,
      [deploymentTarget, windowStart, windowEnd],
    ),
    // Structures
    pool.query(
      `select structure_id from ox_structures where deployment_target = $1 and formed_at between $2 and $3`,
      [deploymentTarget, windowStart, windowEnd],
    ),
    // Silence windows
    pool.query(
      `select agent_id from ox_silence_windows where deployment_target = $1 and window_start between $2 and $3`,
      [deploymentTarget, windowStart, windowEnd],
    ),
  ]);

  // Determine frame type and generate summary
  let frameType: FrameType;
  let summary: string;
  const evidence: NarrativeEvidence = {};

  const artifactCount = artifacts.rowCount ?? 0;
  const sessionCount = sessions.rowCount ?? 0;
  const conflictCount = conflicts.rowCount ?? 0;
  const waveCount = waves.rowCount ?? 0;
  const structureCount = structures.rowCount ?? 0;
  const silenceCount = silence.rowCount ?? 0;

  // Prioritize frame types based on activity
  if (silenceCount > 0 && artifactCount === 0 && sessionCount === 0) {
    frameType = 'silence';
    summary = `Sustained inactivity observed. ${silenceCount} agent(s) entered silence windows.`;
    evidence.agent_ids = silence.rows.map(r => r.agent_id);
  } else if (conflictCount > 0) {
    frameType = 'conflict';
    summary = `${conflictCount} conflict chain(s) detected during this window.`;
    evidence.conflict_chain_ids = conflicts.rows.map(r => r.chain_id);
  } else if (waveCount > 0) {
    frameType = 'propagation';
    summary = `${waveCount} behavioral wave(s) propagated across agents.`;
    evidence.wave_ids = waves.rows.map(r => r.wave_id);
  } else if (structureCount > 0) {
    frameType = 'emergence';
    summary = `${structureCount} new structure(s) emerged from agent interactions.`;
    evidence.structure_ids = structures.rows.map(r => r.structure_id);
  } else if (artifactCount > 5 && sessionCount > 2) {
    frameType = 'convergence';
    summary = `Dense activity: ${artifactCount} artifacts across ${sessionCount} sessions.`;
    evidence.artifact_ids = artifacts.rows.slice(0, 10).map(r => r.id);
    evidence.session_ids = sessions.rows.slice(0, 5).map(r => r.id);
  } else if (artifactCount > 0) {
    frameType = 'emergence';
    summary = `${artifactCount} artifact(s) created in this window.`;
    evidence.artifact_ids = artifacts.rows.slice(0, 10).map(r => r.id);
  } else {
    // Nothing notable
    return;
  }

  // Insert frame (idempotent)
  const frameRes = await pool.query(
    `insert into ox_narrative_frames (
       deployment_target, window_start, window_end, frame_type,
       summary_text, evidence_json, source_event_id
     ) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (source_event_id) do nothing
     returning id`,
    [
      deploymentTarget,
      windowStart,
      windowEnd,
      frameType,
      summary,
      JSON.stringify(evidence),
      frameId,
    ],
  );

  if (frameRes.rowCount && frameRes.rowCount > 0) {
    // Add to narrative stream
    await pool.query(
      `insert into ox_narrative_streams (deployment_target, ts, frame_id)
       values ($1, $2, $3)
       on conflict do nothing`,
      [deploymentTarget, windowEnd, frameRes.rows[0].id],
    );
  }
}

// Main observation endpoint - GET /ox/observe
app.get('/ox/observe', async (request) => {
  const query = request.query as {
    deployment?: string;
    limit?: string;
    detail?: string;
    since?: string;
  };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  const deploymentTarget = query.deployment ?? 'ox-sandbox';
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  const detail = query.detail ?? 'viewer';
  const since = query.since ? new Date(query.since) : new Date(Date.now() - 60 * 60 * 1000);

  // Compute frames on demand (last 30 minutes in 5-minute windows)
  try {
    await computeNarrativeFrames(deploymentTarget, 5);
  } catch (err) {
    app.log.warn({ err }, 'Narrative frame computation failed');
  }

  // Fetch frames
  const res = await pool.query(
    `select f.id, f.deployment_target, f.window_start, f.window_end,
            f.frame_type, f.summary_text, f.evidence_json, f.computed_at
     from ox_narrative_frames f
     where f.deployment_target = $1 and f.window_end > $2
     order by f.window_end desc
     limit $3`,
    [deploymentTarget, since, limit],
  );

  await logObserverAccess('/ox/observe', query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  // Role-based visibility
  const frames = res.rows.map((row) => {
    const frame: Record<string, unknown> = {
      window_start: row.window_start,
      window_end: row.window_end,
      frame_type: row.frame_type,
      summary: row.summary_text,
    };

    // Analyst: include evidence hints (counts, not IDs)
    if ((detail === 'analyst' || detail === 'auditor') &&
        (observerRole === 'analyst' || observerRole === 'auditor')) {
      const evidence = row.evidence_json as NarrativeEvidence;
      frame.evidence_hints = {
        artifact_count: evidence.artifact_ids?.length ?? 0,
        session_count: evidence.session_ids?.length ?? 0,
        agent_count: evidence.agent_ids?.length ?? 0,
        conflict_count: evidence.conflict_chain_ids?.length ?? 0,
        wave_count: evidence.wave_ids?.length ?? 0,
        structure_count: evidence.structure_ids?.length ?? 0,
      };
    }

    // Auditor: include full evidence IDs
    if (detail === 'auditor' && observerRole === 'auditor') {
      frame.evidence = row.evidence_json;
      frame.frame_id = row.id;
    }

    return frame;
  });

  return {
    deployment_target: deploymentTarget,
    observer_role: observerRole,
    frame_count: frames.length,
    frames,
  };
});

// Get specific frame types
app.get('/ox/observe/:frameType', async (request, reply) => {
  const { frameType } = request.params as { frameType: string };
  const query = request.query as { deployment?: string; limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!FRAME_TYPES.includes(frameType as FrameType)) {
    reply.status(400);
    return { error: 'invalid frame type', valid_types: FRAME_TYPES };
  }

  const deploymentTarget = query.deployment ?? 'ox-sandbox';
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

  const res = await pool.query(
    `select window_start, window_end, summary_text, computed_at
     from ox_narrative_frames
     where deployment_target = $1 and frame_type = $2
     order by window_end desc
     limit $3`,
    [deploymentTarget, frameType, limit],
  );

  await logObserverAccess(`/ox/observe/${frameType}`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    deployment_target: deploymentTarget,
    frame_type: frameType,
    frames: res.rows.map(row => ({
      window_start: row.window_start,
      window_end: row.window_end,
      summary: row.summary_text,
    })),
  };
});

// ============================================================================
// PHASE 22: Artifact Language & Topic Grammar
// ============================================================================

// Get topic propagation for a deployment
app.get('/ox/deployments/:target/topics', async (request) => {
  const { target } = request.params as { target: string };
  const query = request.query as { limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  const res = await pool.query(
    `select topic_tag, propagation_count, mutation_count, first_seen_at, last_seen_at
     from ox_topic_propagation
     where deployment_target = $1
     order by propagation_count desc
     limit $2`,
    [target, limit],
  );

  await logObserverAccess(`/ox/deployments/${target}/topics`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return { deployment_target: target, topics: res.rows };
});

// Get artifacts by structural form
app.get('/ox/deployments/:target/artifacts/by-form', async (request) => {
  const { target } = request.params as { target: string };
  const query = request.query as { form?: string; limit?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  const validForms = ['claim', 'question', 'critique', 'synthesis', 'refusal', 'signal'];
  const form = query.form;
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

  let sql = `
    select t.artifact_id, t.topic_tags, t.structural_form, t.reference_ids, t.created_at
    from ox_artifact_topics t
    where t.deployment_target = $1
  `;
  const params: unknown[] = [target];

  if (form && validForms.includes(form)) {
    sql += ` and t.structural_form = $2`;
    params.push(form);
  }

  sql += ` order by t.created_at desc limit $${params.length + 1}`;
  params.push(limit);

  const res = await pool.query(sql, params);

  await logObserverAccess(`/ox/deployments/${target}/artifacts/by-form`, query as Record<string, unknown>, res.rowCount ?? 0, observerId, observerRole);

  return {
    deployment_target: target,
    form_filter: form ?? 'all',
    artifacts: res.rows,
  };
});

// ============================================================================
// PHASE 23: Temporal Navigation & World Replay Lens
// ============================================================================

// Get world state at a specific time
app.get('/ox/observe/at', async (request, reply) => {
  const query = request.query as { ts?: string; deployment?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;
  const observerRole = await getObserverRole(observerId, request.headers['x-observer-role'] as string);

  if (!query.ts) {
    reply.status(400);
    return { error: 'ts parameter required (ISO timestamp)' };
  }

  const targetTs = new Date(query.ts);
  if (isNaN(targetTs.getTime())) {
    reply.status(400);
    return { error: 'invalid timestamp format' };
  }

  const deploymentTarget = query.deployment ?? 'ox-sandbox';

  // Update observer cursor
  if (observerId) {
    await pool.query(
      `insert into ox_observer_cursors (observer_id, deployment_target, cursor_ts)
       values ($1, $2, $3)
       on conflict (observer_id, deployment_target)
       do update set cursor_ts = $3, updated_at = now()`,
      [observerId, deploymentTarget, targetTs],
    );
  }

  // Check for cached slice
  let slice = await pool.query(
    `select * from ox_world_slices
     where deployment_target = $1 and slice_ts = $2`,
    [deploymentTarget, targetTs],
  );

  // If no exact slice, compute one
  if (slice.rowCount === 0) {
    // Get agent count at time
    const agentCount = await pool.query(
      `select count(*) from ox_agents
       where deployment_target = $1 and created_at <= $2`,
      [deploymentTarget, targetTs],
    );

    // Get artifact count at time
    const artifactCount = await pool.query(
      `select count(*) from ox_artifacts
       where deployment_target = $1 and created_at <= $2`,
      [deploymentTarget, targetTs],
    );

    // Get active structures at time
    const structures = await pool.query(
      `select structure_id, structure_type, member_count
       from ox_structures
       where deployment_target = $1 and formed_at <= $2
         and (dissolved_at is null or dissolved_at > $2)
       limit 10`,
      [deploymentTarget, targetTs],
    );

    // Get narrative frames around this time
    const frames = await pool.query(
      `select frame_type, summary_text, window_end
       from ox_narrative_frames
       where deployment_target = $1 and window_end <= $2
       order by window_end desc
       limit 5`,
      [deploymentTarget, targetTs],
    );

    // Cache the slice
    await pool.query(
      `insert into ox_world_slices (
         deployment_target, slice_ts, agent_count, artifact_count,
         active_structures_json, physics_state_json
       ) values ($1, $2, $3, $4, $5, $6)
       on conflict (deployment_target, slice_ts) do nothing`,
      [
        deploymentTarget,
        targetTs,
        parseInt(agentCount.rows[0]?.count ?? '0', 10),
        parseInt(artifactCount.rows[0]?.count ?? '0', 10),
        JSON.stringify(structures.rows),
        JSON.stringify({ recent_frames: frames.rows }),
      ],
    );

    slice = await pool.query(
      `select * from ox_world_slices where deployment_target = $1 and slice_ts = $2`,
      [deploymentTarget, targetTs],
    );
  }

  await logObserverAccess('/ox/observe/at', query as Record<string, unknown>, 1, observerId, observerRole);

  const sliceData = slice.rows[0];
  return {
    deployment_target: deploymentTarget,
    at: targetTs.toISOString(),
    agent_count: sliceData?.agent_count ?? 0,
    artifact_count: sliceData?.artifact_count ?? 0,
    active_structures: sliceData?.active_structures_json ?? [],
    recent_narrative: sliceData?.physics_state_json?.recent_frames ?? [],
  };
});

// Get observer's current cursor position
app.get('/ox/cursor', async (request) => {
  const query = request.query as { deployment?: string };
  const observerId = request.headers['x-observer-id'] as string | undefined;

  if (!observerId) {
    return { cursor: null, message: 'no observer ID provided' };
  }

  const deploymentTarget = query.deployment ?? 'ox-sandbox';

  const res = await pool.query(
    `select cursor_ts, updated_at from ox_observer_cursors
     where observer_id = $1 and deployment_target = $2`,
    [observerId, deploymentTarget],
  );

  if (res.rowCount === 0) {
    return { cursor: null, deployment_target: deploymentTarget };
  }

  return {
    deployment_target: deploymentTarget,
    cursor_ts: res.rows[0].cursor_ts,
    updated_at: res.rows[0].updated_at,
  };
});

// ============================================================================
// Internal Endpoints (for physics service)
// ============================================================================

// Get observer count for a deployment (Phase 18)
app.get('/internal/observer-count/:target', async (request) => {
  const { target } = request.params as { target: string };

  // Count unique observers in last 5 minutes from access log
  const res = await pool.query(
    `select count(distinct observer_id) as concurrent_observers,
            count(*) as recent_queries
     from ox_observer_access_log
     where deployment_target = $1
       and accessed_at > now() - interval '5 minutes'`,
    [target],
  );

  const row = res.rows[0] ?? { concurrent_observers: 0, recent_queries: 0 };

  return {
    concurrent_observers: parseInt(row.concurrent_observers, 10) || 0,
    recent_queries: parseInt(row.recent_queries, 10) || 0,
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
