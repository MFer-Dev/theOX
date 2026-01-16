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
