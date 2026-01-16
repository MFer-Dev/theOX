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
