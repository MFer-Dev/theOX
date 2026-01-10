import { getPool } from '@platform/shared';

const pool = getPool('cred');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists cred_balances (
  user_id uuid primary key,
  claims_remaining int not null default 5,
  replies_remaining int not null default 10,
  endorses_remaining int not null default 5,
  notes_remaining int not null default 3,
  updated_at timestamptz not null default now()
);

create table if not exists cred_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  delta_claims int default 0,
  delta_replies int default 0,
  delta_endorses int default 0,
  delta_notes int default 0,
  reason_code text not null,
  correlation_id text,
  created_at timestamptz not null default now(),
  ref_event_id uuid
);

create table if not exists idempotency_keys (
  idempotency_key text primary key,
  response_body jsonb,
  created_at timestamptz not null default now()
);

create table if not exists outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  topic text not null,
  payload_json jsonb not null,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text
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
create index if not exists idx_events_actor_id on events (actor_id);
create index if not exists idx_events_event_type on events (event_type);
create index if not exists idx_events_correlation on events (correlation_id);
`;

const run = async () => {
  await pool.query(sql);
  console.log('cred migrations applied');
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

