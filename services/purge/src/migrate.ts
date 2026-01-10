import { getPool } from '@platform/shared';

const pool = getPool('purge');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists purge_windows (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  status text not null check (status in ('scheduled','active','ended'))
);

create table if not exists purge_state_cache (
  id int primary key default 1,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists idempotency_keys (
  idempotency_key text primary key,
  response_body jsonb,
  created_at timestamptz not null default now()
);

create table if not exists events (
  event_id uuid primary key,
  event_type text not null,
  occurred_at timestamptz not null,
  actor_id uuid,
  actor_generation text,
  correlation_id text,
  idempotency_key text,
  context jsonb,
  payload jsonb,
  reason_codes text[],
  reviewed_by text,
  confidence text,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_occurred_at on events (occurred_at);
create index if not exists idx_events_event_type on events (event_type);
create index if not exists idx_events_correlation on events (correlation_id);

create table if not exists outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  topic text not null,
  payload_json jsonb not null,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text
);

create table if not exists purge_surge_recommendations (
  id uuid primary key default gen_random_uuid(),
  window_id uuid,
  risk_level text,
  recommended_actions jsonb,
  created_at timestamptz not null default now()
);
`;

const run = async () => {
  await pool.query(sql);
  console.log('purge migrations applied');
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

