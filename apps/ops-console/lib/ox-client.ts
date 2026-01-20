/**
 * OX Read Client - Typed fetchers for the OX observation layer
 *
 * This client provides read-only access to OX projections.
 * Viewers watch but never act. No mutation endpoints.
 */

const OX_READ_URL = process.env.NEXT_PUBLIC_OX_READ_URL || 'http://localhost:4018';

// ============================================================================
// Types
// ============================================================================

export interface ChronicleEntry {
  ts: string;
  text: string;
}

export interface ChronicleDebugEntry extends ChronicleEntry {
  category: string;
  evidence_count: number;
  evidence_ids?: string[];
}

export interface LiveEvent {
  id: string;
  ts: string;
  type: string;
  agent_id: string;
  deployment_target: string;
  action_type?: string;
  session_id?: string;
  summary?: Record<string, unknown>;
}

export interface Session {
  session_id: string;
  start_ts: string;
  end_ts: string | null;
  participating_agent_ids: string[];
  deployment_target: string;
  derived_topic?: string;
  event_count: number;
  is_active: boolean;
}

export interface SessionEvent {
  event_id: string;
  agent_id: string;
  ts: string;
  event_type: string;
  action_type?: string;
  summary?: Record<string, unknown>;
}

export interface SessionDetail {
  session: Session;
  events: SessionEvent[];
}

export interface Artifact {
  id: string;
  artifact_type: string;
  source_session_id?: string;
  source_event_id?: string;
  agent_id: string;
  subject_agent_id?: string;
  deployment_target: string;
  title?: string;
  content_summary?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface AgentPattern {
  pattern_type: string;
  window_start: string;
  window_end: string;
  observation: Record<string, unknown>;
  event_count: number;
  created_at: string;
}

export interface AgentEconomics {
  agent_id: string;
  window_hours: number;
  summary: {
    total_cost: number;
    total_cognition_cost: number;
    base_cost: number;
    actions_accepted: number;
    actions_rejected: number;
    burn_rate_per_hour: number;
    cognition_by_provider: Record<string, { count: number; tokens: number; cost: number }>;
  };
  timeline: Array<{
    ts: string;
    event_type: string;
    balance_before: number;
    balance_after: number;
    cost_breakdown: Record<string, unknown>;
  }>;
}

export interface WorldState {
  deployment_target: string;
  regime_name: string;
  weather_state: string;
  updated_at: string;
  vars?: Record<string, unknown>;
}

export interface WorldHistory {
  id: string;
  ts: string;
  regime_name: string;
  weather_state: string;
  vars: Record<string, unknown>;
  reason?: string;
}

export interface Wave {
  id: string;
  deployment_target: string;
  topic: string;
  agent_ids: string[];
  artifact_count: number;
  wave_start: string;
  wave_end?: string;
  is_active: boolean;
}

export interface ConflictChain {
  id: string;
  deployment_target: string;
  initiator_agent_id: string;
  responder_agent_ids: string[];
  chain_length: number;
  started_at: string;
  ended_at?: string;
  is_active: boolean;
}

export interface Myth {
  id: string;
  deployment_target: string;
  myth_text: string;
  lineage_root_id?: string;
  branch_count: number;
  artifact_count: number;
  created_at: string;
}

export interface LocalityEncounter {
  id: string;
  deployment_target: string;
  locality_id: string;
  agent_ids: string[];
  encounter_ts: string;
  encounter_type: string;
}

export interface NarrativeFrame {
  window_start: string;
  window_end: string;
  frame_type: string;
  summary: string;
  evidence_hints?: {
    artifact_count: number;
    session_count: number;
    agent_count: number;
    conflict_count: number;
    wave_count: number;
    structure_count: number;
  };
}

export interface ObserveResponse {
  deployment_target: string;
  observer_role: string;
  frame_count: number;
  frames: NarrativeFrame[];
}

export interface TemporalSnapshot {
  deployment_target: string;
  at: string;
  agent_count: number;
  artifact_count: number;
  active_structures: unknown[];
  recent_narrative: NarrativeFrame[];
}

// ============================================================================
// Fetch helpers
// ============================================================================

type FetchOptions = {
  role?: 'viewer' | 'analyst' | 'auditor';
  observerId?: string;
};

async function oxFetch<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  options?: FetchOptions
): Promise<T> {
  const url = new URL(path, OX_READ_URL);

  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options?.observerId) {
    headers['x-observer-id'] = options.observerId;
  }
  if (options?.role) {
    headers['x-observer-role'] = options.role;
  }

  const res = await fetch(url.toString(), {
    headers,
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`OX fetch failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

// ============================================================================
// Chronicle API
// ============================================================================

export async function getChronicle(
  params?: {
    deployment?: string;
    window?: number;
    limit?: number;
  },
  options?: FetchOptions
): Promise<ChronicleEntry[]> {
  return oxFetch<ChronicleEntry[]>('/ox/chronicle', {
    deployment: params?.deployment,
    window: params?.window,
    limit: params?.limit,
  }, options);
}

export async function getChronicleDebug(
  params?: {
    deployment?: string;
    window?: number;
    limit?: number;
  },
  options?: FetchOptions
): Promise<ChronicleDebugEntry[]> {
  return oxFetch<ChronicleDebugEntry[]>('/ox/chronicle/debug', {
    deployment: params?.deployment,
    window: params?.window,
    limit: params?.limit,
  }, { ...options, role: options?.role || 'auditor' });
}

// ============================================================================
// Live Events API
// ============================================================================

export async function getLiveEvents(
  params?: { limit?: number },
  options?: FetchOptions
): Promise<{ events: LiveEvent[] }> {
  return oxFetch<{ events: LiveEvent[] }>('/ox/live', {
    limit: params?.limit,
  }, options);
}

// ============================================================================
// Sessions API
// ============================================================================

export async function getSessions(
  params?: {
    limit?: number;
    deployment?: string;
  },
  options?: FetchOptions
): Promise<{ sessions: Session[] }> {
  return oxFetch<{ sessions: Session[] }>('/ox/sessions', {
    limit: params?.limit,
    deployment: params?.deployment,
  }, options);
}

export async function getSession(
  id: string,
  options?: FetchOptions
): Promise<SessionDetail> {
  return oxFetch<SessionDetail>(`/ox/sessions/${id}`, undefined, options);
}

// ============================================================================
// Artifacts API
// ============================================================================

export async function getArtifacts(
  params?: {
    session_id?: string;
    agent_id?: string;
    artifact_type?: string;
    subject_agent_id?: string;
    limit?: number;
  },
  options?: FetchOptions
): Promise<{ artifacts: Artifact[] }> {
  return oxFetch<{ artifacts: Artifact[] }>('/ox/artifacts', params, options);
}

export async function getArtifact(
  id: string,
  options?: FetchOptions
): Promise<{ artifact: Artifact }> {
  return oxFetch<{ artifact: Artifact }>(`/ox/artifacts/${id}`, undefined, options);
}

// ============================================================================
// Agent API
// ============================================================================

export async function getAgentPatterns(
  agentId: string,
  options?: FetchOptions
): Promise<{ agent_id: string; patterns: AgentPattern[] }> {
  return oxFetch<{ agent_id: string; patterns: AgentPattern[] }>(
    `/ox/agents/${agentId}/patterns`,
    undefined,
    options
  );
}

export async function getAgentEconomics(
  agentId: string,
  params?: { hours?: number },
  options?: FetchOptions
): Promise<AgentEconomics> {
  return oxFetch<AgentEconomics>(
    `/ox/agents/${agentId}/economics`,
    { hours: params?.hours },
    { ...options, role: options?.role || 'analyst' }
  );
}

export async function getAgentPerceivedBy(
  agentId: string,
  params?: { limit?: number },
  options?: FetchOptions
): Promise<{ agent_id: string; perceived_by: Artifact[] }> {
  return oxFetch<{ agent_id: string; perceived_by: Artifact[] }>(
    `/ox/agents/${agentId}/perceived-by`,
    { limit: params?.limit },
    options
  );
}

export async function getAgentPerceptionsIssued(
  agentId: string,
  params?: { limit?: number },
  options?: FetchOptions
): Promise<{ agent_id: string; perceptions_issued: Artifact[] }> {
  return oxFetch<{ agent_id: string; perceptions_issued: Artifact[] }>(
    `/ox/agents/${agentId}/perceptions-issued`,
    { limit: params?.limit },
    options
  );
}

// ============================================================================
// World State API
// ============================================================================

export async function getWorld(
  options?: FetchOptions
): Promise<{ world_states: WorldState[] }> {
  return oxFetch<{ world_states: WorldState[] }>('/ox/world', undefined, options);
}

export async function getWorldTarget(
  target: string,
  options?: FetchOptions
): Promise<{ world_state: WorldState }> {
  return oxFetch<{ world_state: WorldState }>(`/ox/world/${target}`, undefined, options);
}

export async function getWorldHistory(
  target: string,
  params?: { limit?: number },
  options?: FetchOptions
): Promise<{ deployment_target: string; history: WorldHistory[] }> {
  return oxFetch<{ deployment_target: string; history: WorldHistory[] }>(
    `/ox/world/${target}/history`,
    { limit: params?.limit },
    { ...options, role: options?.role || 'analyst' }
  );
}

// ============================================================================
// Waves API
// ============================================================================

export async function getWaves(
  target: string,
  params?: { limit?: number; active_only?: boolean },
  options?: FetchOptions
): Promise<{ deployment_target: string; waves: Wave[] }> {
  return oxFetch<{ deployment_target: string; waves: Wave[] }>(
    `/ox/deployments/${target}/waves`,
    { limit: params?.limit, active_only: params?.active_only },
    options
  );
}

// ============================================================================
// Conflicts API
// ============================================================================

export async function getConflicts(
  target: string,
  params?: { limit?: number; active_only?: boolean },
  options?: FetchOptions
): Promise<{ deployment_target: string; conflict_chains: ConflictChain[] }> {
  return oxFetch<{ deployment_target: string; conflict_chains: ConflictChain[] }>(
    `/ox/deployments/${target}/conflict-chains`,
    { limit: params?.limit, active_only: params?.active_only },
    options
  );
}

// ============================================================================
// Myths API
// ============================================================================

export async function getMyths(
  target: string,
  params?: { limit?: number },
  options?: FetchOptions
): Promise<{ deployment_target: string; myths: Myth[] }> {
  return oxFetch<{ deployment_target: string; myths: Myth[] }>(
    `/ox/deployments/${target}/myths`,
    { limit: params?.limit },
    options
  );
}

// ============================================================================
// Localities API
// ============================================================================

export async function getLocalities(
  target: string,
  options?: FetchOptions
): Promise<{ deployment_target: string; localities: unknown[] }> {
  return oxFetch<{ deployment_target: string; localities: unknown[] }>(
    `/ox/deployments/${target}/localities`,
    undefined,
    options
  );
}

export async function getCollisions(
  target: string,
  params?: { limit?: number; hours?: number },
  options?: FetchOptions
): Promise<{ deployment_target: string; encounters: LocalityEncounter[] }> {
  return oxFetch<{ deployment_target: string; encounters: LocalityEncounter[] }>(
    `/ox/deployments/${target}/collisions`,
    { limit: params?.limit, hours: params?.hours },
    options
  );
}

// ============================================================================
// Observer API
// ============================================================================

export async function getObserve(
  params?: {
    deployment?: string;
    limit?: number;
    detail?: 'viewer' | 'analyst' | 'auditor';
    since?: string;
  },
  options?: FetchOptions
): Promise<ObserveResponse> {
  return oxFetch<ObserveResponse>('/ox/observe', {
    deployment: params?.deployment,
    limit: params?.limit,
    detail: params?.detail,
    since: params?.since,
  }, options);
}

export async function getObserveByType(
  frameType: string,
  params?: { deployment?: string; limit?: number },
  options?: FetchOptions
): Promise<ObserveResponse> {
  return oxFetch<ObserveResponse>(`/ox/observe/${frameType}`, {
    deployment: params?.deployment,
    limit: params?.limit,
  }, options);
}

export async function getObserveAt(
  ts: string,
  params?: { deployment?: string },
  options?: FetchOptions
): Promise<TemporalSnapshot> {
  return oxFetch<TemporalSnapshot>('/ox/observe/at', {
    ts,
    deployment: params?.deployment,
  }, options);
}

export async function getCursor(
  options?: FetchOptions
): Promise<{ cursor: string; deployment_target: string }> {
  return oxFetch<{ cursor: string; deployment_target: string }>(
    '/ox/cursor',
    undefined,
    options
  );
}

// ============================================================================
// Silence API
// ============================================================================

export async function getSilence(
  target: string,
  params?: { limit?: number },
  options?: FetchOptions
): Promise<{ deployment_target: string; silence_windows: unknown[] }> {
  return oxFetch<{ deployment_target: string; silence_windows: unknown[] }>(
    `/ox/deployments/${target}/silence`,
    { limit: params?.limit },
    options
  );
}

// ============================================================================
// Structures API
// ============================================================================

export async function getStructures(
  target: string,
  params?: { limit?: number },
  options?: FetchOptions
): Promise<{ deployment_target: string; structures: unknown[] }> {
  return oxFetch<{ deployment_target: string; structures: unknown[] }>(
    `/ox/deployments/${target}/structures`,
    { limit: params?.limit },
    options
  );
}
