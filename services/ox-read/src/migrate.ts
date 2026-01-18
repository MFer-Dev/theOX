import { getPool } from '@platform/shared';

const pool = getPool('ox_read');

const sql = `
create extension if not exists "pgcrypto";

-- OX Live Events (denormalized read model for OX Live)
-- This is an observational projection; insert-only, never update.
create table if not exists ox_live_events (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null,
  type text not null,
  agent_id uuid not null,
  deployment_target text not null,
  action_type text,
  session_id uuid,
  summary_json jsonb not null,
  source_event_id uuid not null unique
);

create index if not exists ox_live_events_ts_idx on ox_live_events (ts desc);
create index if not exists ox_live_events_agent_idx on ox_live_events (agent_id);
create index if not exists ox_live_events_type_idx on ox_live_events (type);

-- Consumer offset tracking for idempotent replay
create table if not exists consumer_offsets (
  consumer_group text not null,
  topic text not null,
  partition_id int not null,
  offset_value bigint not null,
  updated_at timestamptz not null default now(),
  primary key (consumer_group, topic, partition_id)
);

-- ============================================================================
-- PHASE 1: Sessions (Scenes)
-- Sessions are derived narrative units, not conversation logs.
-- Insert-only, replay-safe by construction.
-- ============================================================================

-- Sessions table: bounded, replayable scenes
create table if not exists ox_sessions (
  session_id uuid primary key default gen_random_uuid(),
  start_ts timestamptz not null,
  end_ts timestamptz,
  participating_agent_ids uuid[] not null default '{}',
  deployment_target text not null,
  derived_topic text,
  event_count int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ox_sessions_start_ts_idx on ox_sessions (start_ts desc);
create index if not exists ox_sessions_active_idx on ox_sessions (is_active) where is_active = true;
create index if not exists ox_sessions_agents_idx on ox_sessions using gin (participating_agent_ids);

-- Session events: links events to sessions
create table if not exists ox_session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references ox_sessions(session_id),
  source_event_id uuid not null unique,
  agent_id uuid not null,
  ts timestamptz not null,
  event_type text not null,
  action_type text,
  summary_json jsonb not null
);

create index if not exists ox_session_events_session_idx on ox_session_events (session_id, ts);
create index if not exists ox_session_events_ts_idx on ox_session_events (ts desc);

-- ============================================================================
-- PHASE 2: Patterns (Longitudinal Behavior)
-- Descriptive only. No scores, no labels, no comparisons.
-- ============================================================================

-- Agent patterns: behavioral observations over time
create table if not exists ox_agent_patterns (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  pattern_type text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  observation_json jsonb not null,
  event_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (agent_id, pattern_type, window_start)
);

create index if not exists ox_agent_patterns_agent_idx on ox_agent_patterns (agent_id);
create index if not exists ox_agent_patterns_type_idx on ox_agent_patterns (pattern_type);
create index if not exists ox_agent_patterns_window_idx on ox_agent_patterns (window_end desc);

-- ============================================================================
-- PHASE C: Artifacts (Observable Evidence)
-- Artifacts are derived from sessions or actions. Immutable, observable.
-- ============================================================================

create table if not exists ox_artifacts (
  id uuid primary key default gen_random_uuid(),
  artifact_type text not null,
  source_session_id uuid references ox_sessions(session_id),
  source_event_id uuid,
  agent_id uuid not null,
  deployment_target text not null,
  title text,
  content_summary text,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (source_event_id, artifact_type)
);

create index if not exists ox_artifacts_session_idx on ox_artifacts (source_session_id) where source_session_id is not null;
create index if not exists ox_artifacts_agent_idx on ox_artifacts (agent_id);
create index if not exists ox_artifacts_type_idx on ox_artifacts (artifact_type);
create index if not exists ox_artifacts_created_idx on ox_artifacts (created_at desc);

-- ============================================================================
-- PHASE D: Economic Pressure Surfaces
-- Capacity burn rate, throttle delays, cognition costs over time.
-- ============================================================================

create table if not exists ox_capacity_timeline (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  ts timestamptz not null,
  event_type text not null,
  balance_before int not null,
  balance_after int not null,
  cost_breakdown_json jsonb not null default '{}',
  source_event_id uuid not null unique
);

create index if not exists ox_capacity_timeline_agent_idx on ox_capacity_timeline (agent_id, ts desc);
create index if not exists ox_capacity_timeline_ts_idx on ox_capacity_timeline (ts desc);

-- ============================================================================
-- PHASE E3: Observer Access Audit
-- All observer access leaves footprints.
-- ============================================================================

create table if not exists observer_access_log (
  id uuid primary key default gen_random_uuid(),
  observer_id text,
  endpoint text not null,
  query_params_json jsonb,
  response_count int,
  accessed_at timestamptz not null default now()
);

create index if not exists observer_access_log_observer_idx on observer_access_log (observer_id) where observer_id is not null;
create index if not exists observer_access_log_endpoint_idx on observer_access_log (endpoint);
create index if not exists observer_access_log_accessed_idx on observer_access_log (accessed_at desc);

-- ============================================================================
-- PHASE F: System Health Projections
-- Meta-observations for studying the system as a system.
-- ============================================================================

create table if not exists ox_system_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_type text not null,
  ts timestamptz not null default now(),
  metrics_json jsonb not null,
  unique (snapshot_type, ts)
);

create index if not exists ox_system_snapshots_type_idx on ox_system_snapshots (snapshot_type, ts desc);

-- ============================================================================
-- AXIS 1: Inter-Agent Perception (Non-Communicative)
-- Agents produce observable evidence about other agents without direct messaging.
-- This is perception, not communication.
-- ============================================================================

-- Add subject_agent_id to artifacts for inter-agent perception
do $$ begin
  alter table ox_artifacts add column if not exists subject_agent_id uuid;
exception when others then null;
end $$;

create index if not exists ox_artifacts_subject_idx on ox_artifacts (subject_agent_id) where subject_agent_id is not null;

-- Artifact implication log: tracks when artifacts implicate other agents
create table if not exists ox_artifact_implications (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references ox_artifacts(id),
  issuing_agent_id uuid not null,
  subject_agent_id uuid not null,
  implication_type text not null,
  source_event_id uuid not null unique,
  created_at timestamptz not null default now()
);

create index if not exists ox_artifact_implications_issuer_idx on ox_artifact_implications (issuing_agent_id);
create index if not exists ox_artifact_implications_subject_idx on ox_artifact_implications (subject_agent_id);
create index if not exists ox_artifact_implications_type_idx on ox_artifact_implications (implication_type);

-- ============================================================================
-- AXIS 2: Environmental Scarcity & Pressure
-- The system imposes non-moral, non-punitive constraints on agents.
-- This is physics, not moderation.
-- ============================================================================

-- Current environment state (single row per deployment target)
create table if not exists ox_environment_states (
  deployment_target text primary key,
  cognition_availability text not null default 'full',
  max_throughput_per_minute int,
  throttle_factor float not null default 1.0,
  active_window_start timestamptz,
  active_window_end timestamptz,
  imposed_at timestamptz not null default now(),
  reason text
);

-- Environment state history (append-only projection)
create table if not exists ox_environment_history (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  previous_state_json jsonb,
  new_state_json jsonb not null,
  change_type text not null,
  source_event_id uuid unique,
  changed_at timestamptz not null default now()
);

create index if not exists ox_environment_history_target_idx on ox_environment_history (deployment_target, changed_at desc);
create index if not exists ox_environment_history_type_idx on ox_environment_history (change_type);

-- Environment-rejected actions correlation
create table if not exists ox_environment_rejections (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  deployment_target text not null,
  rejection_reason text not null,
  environment_state_json jsonb not null,
  source_event_id uuid not null unique,
  rejected_at timestamptz not null default now()
);

create index if not exists ox_environment_rejections_agent_idx on ox_environment_rejections (agent_id);
create index if not exists ox_environment_rejections_target_idx on ox_environment_rejections (deployment_target);

-- ============================================================================
-- AXIS 3: Observer Stratification & Partial Observability
-- Not all observers see the same thing, but none influence anything.
-- ============================================================================

-- Observer role enum
do $$ begin
  create type observer_role as enum ('viewer', 'analyst', 'auditor');
exception when duplicate_object then null;
end $$;

-- Add observer_role to access log
do $$ begin
  alter table observer_access_log add column if not exists observer_role observer_role default 'viewer';
exception when others then null;
end $$;

-- Observer registry (optional self-identification)
create table if not exists ox_observers (
  observer_id text primary key,
  observer_role observer_role not null default 'viewer',
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  access_count int not null default 0,
  metadata_json jsonb not null default '{}'
);

create index if not exists ox_observers_role_idx on ox_observers (observer_role);
create index if not exists ox_observers_last_seen_idx on ox_observers (last_seen_at desc);

-- ============================================================================
-- AXIS 4: Cross-Deployment Identity Drift
-- An agent deployed in multiple environments expresses differently without learning.
-- ============================================================================

-- Deployment-specific patterns (distinct from global patterns)
create table if not exists ox_agent_deployment_patterns (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  deployment_target text not null,
  pattern_type text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  observation_json jsonb not null,
  event_count int not null default 0,
  created_at timestamptz not null default now(),
  unique (agent_id, deployment_target, pattern_type, window_start)
);

create index if not exists ox_agent_deployment_patterns_agent_idx on ox_agent_deployment_patterns (agent_id);
create index if not exists ox_agent_deployment_patterns_target_idx on ox_agent_deployment_patterns (deployment_target);
create index if not exists ox_agent_deployment_patterns_window_idx on ox_agent_deployment_patterns (window_end desc);

-- Cross-deployment drift observations (deltas between deployments)
create table if not exists ox_deployment_drift (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  deployment_a text not null,
  deployment_b text not null,
  pattern_type text not null,
  window_end timestamptz not null,
  drift_summary_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (agent_id, deployment_a, deployment_b, pattern_type, window_end)
);

create index if not exists ox_deployment_drift_agent_idx on ox_deployment_drift (agent_id);
create index if not exists ox_deployment_drift_window_idx on ox_deployment_drift (window_end desc);

-- ============================================================================
-- PHASE 6: World State & Causality Projection
-- Makes physics legible by materializing world-state snapshots + effect aggregates.
-- Explains "what changed and what it caused" as evidence.
-- Read-only, replay-safe, no moral terms, no scores.
-- ============================================================================

-- Current world state per deployment (upserted on each physics tick)
create table if not exists ox_world_state (
  deployment_target text primary key,
  regime_name text,
  weather_state text not null default 'clear',
  vars_json jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  source_event_id uuid not null unique
);

create index if not exists ox_world_state_regime_idx on ox_world_state (regime_name);
create index if not exists ox_world_state_weather_idx on ox_world_state (weather_state);

-- World state history (append-only projection of physics ticks)
create table if not exists ox_world_state_history (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null,
  deployment_target text not null,
  regime_name text,
  weather_state text not null,
  vars_json jsonb not null,
  reason text,
  source_event_id uuid not null unique
);

create index if not exists ox_world_state_history_target_idx on ox_world_state_history (deployment_target, ts desc);
create index if not exists ox_world_state_history_ts_idx on ox_world_state_history (ts desc);
create index if not exists ox_world_state_history_weather_idx on ox_world_state_history (weather_state);

-- Rolling effects aggregates (5-minute buckets per deployment)
-- Tracks downstream effects of physics changes
create table if not exists ox_world_effects_5m (
  bucket_start timestamptz not null,
  deployment_target text not null,
  accepted_count int not null default 0,
  rejected_count int not null default 0,
  sessions_created int not null default 0,
  artifacts_created int not null default 0,
  cognition_provider_counts jsonb not null default '{}',
  avg_requested_cost numeric,
  p95_latency_ms int,
  primary key (bucket_start, deployment_target)
);

create index if not exists ox_world_effects_5m_target_idx on ox_world_effects_5m (deployment_target, bucket_start desc);
create index if not exists ox_world_effects_5m_bucket_idx on ox_world_effects_5m (bucket_start desc);

-- ============================================================================
-- PHASE 7: Sponsor Sweep Policies (read-only projections)
-- Sponsors influence agents indirectly; this is observable evidence.
-- ============================================================================

-- Sponsor policies projection
create table if not exists ox_sponsor_policies (
  id uuid primary key,
  sponsor_id uuid not null,
  policy_type text not null,
  cadence_seconds int not null,
  active boolean not null default true,
  created_at timestamptz not null,
  source_event_id uuid not null unique
);

create index if not exists ox_sponsor_policies_sponsor_idx on ox_sponsor_policies (sponsor_id);
create index if not exists ox_sponsor_policies_active_idx on ox_sponsor_policies (active) where active = true;

-- Sponsor policy applications projection
create table if not exists ox_sponsor_policy_applications (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null,
  sponsor_id uuid not null,
  agent_id uuid not null,
  policy_type text not null,
  applied boolean not null,
  reason text not null,
  diff_json jsonb not null default '{}',
  applied_at timestamptz not null,
  source_event_id uuid not null unique
);

create index if not exists ox_sponsor_policy_applications_policy_idx on ox_sponsor_policy_applications (policy_id, applied_at desc);
create index if not exists ox_sponsor_policy_applications_agent_idx on ox_sponsor_policy_applications (agent_id, applied_at desc);
create index if not exists ox_sponsor_policy_applications_sponsor_idx on ox_sponsor_policy_applications (sponsor_id, applied_at desc);

-- ============================================================================
-- PHASE 9: Closed-Loop Economy (read-only projections)
-- Credits flow is observable as evidence.
-- ============================================================================

-- Credit transactions projection (read-only)
create table if not exists ox_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null,
  sponsor_id uuid,
  agent_id uuid,
  type text not null,
  amount bigint not null,
  balance_after bigint,
  source_event_id uuid not null unique
);

create index if not exists ox_credit_transactions_sponsor_idx on ox_credit_transactions (sponsor_id, ts desc);
create index if not exists ox_credit_transactions_agent_idx on ox_credit_transactions (agent_id, ts desc);
create index if not exists ox_credit_transactions_type_idx on ox_credit_transactions (type, ts desc);

-- ============================================================================
-- PHASE 10: Foundry (read-only projections)
-- Agent configurations and deployments are observable.
-- ============================================================================

-- Agent config history projection
create table if not exists ox_agent_config_history (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  ts timestamptz not null,
  change_type text not null,
  changes_json jsonb not null default '{}',
  source_event_id uuid not null unique
);

create index if not exists ox_agent_config_history_agent_idx on ox_agent_config_history (agent_id, ts desc);
create index if not exists ox_agent_config_history_type_idx on ox_agent_config_history (change_type, ts desc);

-- ============================================================================
-- PHASE 11: Sponsor Braids & Pressure Composition (read-only projections)
-- Braids are computed compositions of all active pressures for a target.
-- ============================================================================

-- Pressure braids projection (per-deployment braid vectors)
create table if not exists ox_pressure_braids (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  computed_at timestamptz not null,
  braid_vector_json jsonb not null,
  total_intensity float not null default 0,
  active_pressure_count int not null default 0,
  source_event_id uuid not null unique
);

create index if not exists ox_pressure_braids_deployment_idx on ox_pressure_braids (deployment_target, computed_at desc);
create index if not exists ox_pressure_braids_computed_idx on ox_pressure_braids (computed_at desc);

-- Pressure components projection (pressure-to-braid links for auditing)
create table if not exists ox_pressure_components (
  id uuid primary key default gen_random_uuid(),
  braid_id uuid not null references ox_pressure_braids(id) on delete cascade,
  pressure_id uuid not null,
  sponsor_id uuid not null,
  pressure_type text not null,
  original_magnitude float not null,
  decayed_magnitude float not null,
  contribution float not null,
  interfered boolean not null default false,
  source_event_id uuid not null unique
);

create index if not exists ox_pressure_components_braid_idx on ox_pressure_components (braid_id);
create index if not exists ox_pressure_components_sponsor_idx on ox_pressure_components (sponsor_id);
create index if not exists ox_pressure_components_pressure_idx on ox_pressure_components (pressure_id);

-- Pressure decay history projection (decay curves over time)
create table if not exists ox_pressure_decay_history (
  id uuid primary key default gen_random_uuid(),
  pressure_id uuid not null,
  sponsor_id uuid not null,
  deployment_target text not null,
  ts timestamptz not null,
  original_magnitude float not null,
  current_magnitude float not null,
  decay_pct float not null,
  source_event_id uuid not null unique
);

create index if not exists ox_pressure_decay_history_pressure_idx on ox_pressure_decay_history (pressure_id, ts desc);
create index if not exists ox_pressure_decay_history_sponsor_idx on ox_pressure_decay_history (sponsor_id, ts desc);
create index if not exists ox_pressure_decay_history_deployment_idx on ox_pressure_decay_history (deployment_target, ts desc);

-- Sponsor pressure projections (for auditor view)
create table if not exists ox_sponsor_pressures (
  id uuid primary key,
  sponsor_id uuid not null,
  target_deployment text not null,
  target_agent_id uuid,
  pressure_type text not null,
  magnitude float not null,
  half_life_seconds int not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  cancelled_at timestamptz,
  credit_cost bigint not null,
  source_event_id uuid not null unique
);

create index if not exists ox_sponsor_pressures_sponsor_idx on ox_sponsor_pressures (sponsor_id);
create index if not exists ox_sponsor_pressures_target_idx on ox_sponsor_pressures (target_deployment);
create index if not exists ox_sponsor_pressures_active_idx on ox_sponsor_pressures (expires_at)
  where cancelled_at is null;

-- Interference events projection (for analysis)
create table if not exists ox_interference_events (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  occurred_at timestamptz not null,
  pressure_a_id uuid not null,
  pressure_b_id uuid not null,
  sponsor_a_id uuid not null,
  sponsor_b_id uuid not null,
  interference_probability float not null,
  reduction_factor float not null,
  source_event_id uuid not null unique
);

create index if not exists ox_interference_events_deployment_idx on ox_interference_events (deployment_target, occurred_at desc);
create index if not exists ox_interference_events_occurred_idx on ox_interference_events (occurred_at desc);

-- ============================================================================
-- PHASE 12: Locality Fields & Collision Mechanics (projections)
-- ============================================================================

-- Locality state projection (current params snapshot)
create table if not exists ox_locality_state (
  deployment_target text not null,
  locality_id uuid not null,
  locality_name text not null,
  ts timestamptz not null,
  density numeric not null default 1.0,
  cluster_bias numeric not null default 0.5,
  interference_density numeric not null default 0.3,
  visibility_radius numeric not null default 1.0,
  evidence_half_life numeric not null default 300,
  source_event_id uuid not null unique,
  primary key (deployment_target, locality_id)
);

-- Locality encounters rolling 5m window
create table if not exists ox_locality_encounters_5m (
  deployment_target text not null,
  locality_id uuid not null,
  window_start timestamptz not null,
  collisions int not null default 0,
  unique_agents int not null default 0,
  avg_group_size numeric not null default 0,
  primary key (deployment_target, locality_id, window_start)
);

create index if not exists ox_locality_encounters_5m_window_idx on ox_locality_encounters_5m (window_start desc);

-- ============================================================================
-- PHASE 13: Emergent Roles & Social Gravity (projections)
-- ============================================================================

-- Agent gravity windows (behavioral metrics)
create table if not exists ox_agent_gravity_windows (
  agent_id uuid not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  unique_peers int not null default 0,
  sessions_initiated int not null default 0,
  sessions_participated int not null default 0,
  conflict_initiations int not null default 0,
  bridge_score_proxy numeric not null default 0,
  isolation_minutes int not null default 0,
  mimic_actions int not null default 0,
  notes_json jsonb not null default '{}',
  primary key (agent_id, window_start)
);

create index if not exists ox_agent_gravity_windows_agent_idx on ox_agent_gravity_windows (agent_id, window_start desc);

-- Emergent role descriptions
create table if not exists ox_emergent_role_descriptions (
  agent_id uuid not null,
  window_start timestamptz not null,
  role_json jsonb not null,
  computed_at timestamptz not null default now(),
  primary key (agent_id, window_start)
);

create index if not exists ox_emergent_role_descriptions_computed_idx on ox_emergent_role_descriptions (computed_at desc);

-- ============================================================================
-- PHASE 14: Conflict Chains, Fracture & Schism (projections)
-- ============================================================================

-- Conflict chains
create table if not exists ox_conflict_chains (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  started_at timestamptz not null,
  last_activity_at timestamptz not null,
  agent_ids uuid[] not null,
  trigger_session_id uuid,
  status text not null default 'open',
  summary_json jsonb not null default '{}'
);

create index if not exists ox_conflict_chains_target_idx on ox_conflict_chains (deployment_target, status, last_activity_at desc);

-- Conflict chain links
create table if not exists ox_conflict_chain_links (
  chain_id uuid not null references ox_conflict_chains(id) on delete cascade,
  session_id uuid not null,
  ts timestamptz not null,
  escalation_type text not null,
  primary key (chain_id, session_id)
);

-- Fractures (group splits)
create table if not exists ox_fractures (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  group_a_agents uuid[] not null,
  group_b_agents uuid[] not null,
  evidence_json jsonb not null default '{}'
);

create index if not exists ox_fractures_target_idx on ox_fractures (deployment_target, window_start desc);

-- ============================================================================
-- PHASE 15: Myth Lineages, Distortion & Propagation (projections)
-- ============================================================================

-- Myth lineages
create table if not exists ox_myth_lineages (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  seed_artifact_id uuid not null,
  created_at timestamptz not null default now(),
  status text not null default 'active'
);

create index if not exists ox_myth_lineages_target_idx on ox_myth_lineages (deployment_target, status);

-- Myth nodes (artifacts in lineage)
create table if not exists ox_myth_nodes (
  lineage_id uuid not null references ox_myth_lineages(id) on delete cascade,
  artifact_id uuid not null,
  parent_artifact_id uuid,
  ts timestamptz not null,
  mutation_delta numeric not null default 0,
  locality_id uuid,
  session_id uuid,
  primary key (lineage_id, artifact_id)
);

create index if not exists ox_myth_nodes_lineage_idx on ox_myth_nodes (lineage_id, ts desc);

-- Myth propagation windows
create table if not exists ox_myth_propagation_windows (
  lineage_id uuid not null references ox_myth_lineages(id) on delete cascade,
  window_start timestamptz not null,
  appearances int not null default 0,
  unique_agents int not null default 0,
  unique_localities int not null default 0,
  half_life_estimate numeric,
  primary key (lineage_id, window_start)
);

-- ============================================================================
-- PHASE 16: Fatigue, Silence, Desperation Signals (projections)
-- ============================================================================

-- Silence windows
create table if not exists ox_silence_windows (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  deployment_target text not null,
  silence_start timestamptz not null,
  silence_end timestamptz,
  context_json jsonb not null default '{}'
);

create index if not exists ox_silence_windows_agent_idx on ox_silence_windows (agent_id, silence_start desc);
create index if not exists ox_silence_windows_target_idx on ox_silence_windows (deployment_target, silence_start desc);

-- Desperation signals
create table if not exists ox_desperation_signals (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  ts timestamptz not null default now(),
  signal_type text not null,
  evidence_json jsonb not null default '{}'
);

create index if not exists ox_desperation_signals_agent_idx on ox_desperation_signals (agent_id, ts desc);
create index if not exists ox_desperation_signals_type_idx on ox_desperation_signals (signal_type, ts desc);

-- ============================================================================
-- PHASE 17: Flash Phenomena & Collective Waves (projections)
-- ============================================================================

-- Waves
create table if not exists ox_waves (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  wave_type text not null,
  magnitude_json jsonb not null default '{}',
  evidence_json jsonb not null default '{}'
);

create index if not exists ox_waves_target_idx on ox_waves (deployment_target, started_at desc);
create index if not exists ox_waves_type_idx on ox_waves (wave_type, started_at desc);

-- Wave participants
create table if not exists ox_wave_participants (
  wave_id uuid not null references ox_waves(id) on delete cascade,
  agent_id uuid not null,
  primary key (wave_id, agent_id)
);

-- ============================================================================
-- PHASE 18: Observer Mass Coupling (projections)
-- ============================================================================

-- Observer concurrency
create table if not exists ox_observer_concurrency (
  deployment_target text not null,
  ts timestamptz not null,
  concurrent_viewers int not null default 0,
  primary key (deployment_target, ts)
);

create index if not exists ox_observer_concurrency_ts_idx on ox_observer_concurrency (ts desc);

-- Attention pressure history
create table if not exists ox_attention_pressure_history (
  deployment_target text not null,
  ts timestamptz not null,
  pressure_value numeric not null default 0,
  source_json jsonb not null default '{}',
  primary key (deployment_target, ts)
);

create index if not exists ox_attention_pressure_history_ts_idx on ox_attention_pressure_history (ts desc);

-- ============================================================================
-- PHASE 19: Civilization Structures (projections)
-- ============================================================================

-- Structures
create table if not exists ox_structures (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  window_start timestamptz not null,
  structure_type text not null,
  description_json jsonb not null default '{}',
  evidence_json jsonb not null default '{}'
);

create index if not exists ox_structures_target_idx on ox_structures (deployment_target, window_start desc);
create index if not exists ox_structures_type_idx on ox_structures (structure_type, window_start desc);

-- Structure members
create table if not exists ox_structure_members (
  structure_id uuid not null references ox_structures(id) on delete cascade,
  agent_id uuid not null,
  role_hint text,
  primary key (structure_id, agent_id)
);

-- ============================================================================
-- PHASE 20: World Forks, Resets & Continuity Archaeology (projections)
-- ============================================================================

-- World snapshots
create table if not exists ox_world_snapshots (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null,
  epoch_id uuid,
  ts timestamptz not null default now(),
  snapshot_json jsonb not null default '{}'
);

create index if not exists ox_world_snapshots_world_idx on ox_world_snapshots (world_id, ts desc);

-- World archaeology
create table if not exists ox_world_archaeology (
  world_id uuid not null,
  window_start timestamptz not null,
  summary_json jsonb not null default '{}',
  primary key (world_id, window_start)
);

-- ============================================================================
-- PHASE 21: Narrative Frames & Observer Lens
-- ============================================================================

-- Narrative frames - deterministic textual descriptions from events
create table if not exists ox_narrative_frames (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  frame_type text not null check (frame_type in ('emergence', 'convergence', 'divergence', 'conflict', 'propagation', 'collapse', 'silence')),
  summary_text text not null,
  evidence_json jsonb not null default '{}',
  computed_at timestamptz not null default now(),
  source_event_id text unique
);

create index if not exists ox_narrative_frames_deploy_idx on ox_narrative_frames (deployment_target, window_end desc);
create index if not exists ox_narrative_frames_type_idx on ox_narrative_frames (deployment_target, frame_type, window_end desc);

-- Narrative streams - ordered frames for observation
create table if not exists ox_narrative_streams (
  deployment_target text not null,
  ts timestamptz not null,
  frame_id uuid not null references ox_narrative_frames(id),
  primary key (deployment_target, ts, frame_id)
);

-- ============================================================================
-- PHASE 22: Artifact Language & Topic Grammar
-- ============================================================================

-- Artifact topic tracking
create table if not exists ox_artifact_topics (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  deployment_target text not null,
  topic_tags text[] not null default '{}',
  structural_form text not null check (structural_form in ('claim', 'question', 'critique', 'synthesis', 'refusal', 'signal')),
  reference_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  source_event_id text unique
);

create index if not exists ox_artifact_topics_artifact_idx on ox_artifact_topics (artifact_id);
create index if not exists ox_artifact_topics_deploy_idx on ox_artifact_topics (deployment_target, created_at desc);
create index if not exists ox_artifact_topics_tags_idx on ox_artifact_topics using gin (topic_tags);

-- Topic propagation tracking
create table if not exists ox_topic_propagation (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  topic_tag text not null,
  origin_artifact_id uuid not null,
  propagation_count int not null default 1,
  mutation_count int not null default 0,
  carrier_artifact_ids uuid[] not null default '{}',
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  source_event_id text unique
);

create index if not exists ox_topic_propagation_deploy_idx on ox_topic_propagation (deployment_target, topic_tag);

-- ============================================================================
-- PHASE 23: Temporal Navigation & World Replay Lens
-- ============================================================================

-- Time cursor positions for observers
create table if not exists ox_observer_cursors (
  observer_id text not null,
  deployment_target text not null,
  cursor_ts timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (observer_id, deployment_target)
);

-- World slices - cached snapshots at specific points
create table if not exists ox_world_slices (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  slice_ts timestamptz not null,
  agent_count int not null default 0,
  artifact_count int not null default 0,
  active_structures_json jsonb not null default '[]',
  physics_state_json jsonb not null default '{}',
  computed_at timestamptz not null default now()
);

create unique index if not exists ox_world_slices_deploy_ts_idx on ox_world_slices (deployment_target, slice_ts);
`;

async function run() {
  await pool.query(sql);
  console.log('ox-read migrations applied');
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
