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
