import { getPool } from '@platform/shared';

const pool = getPool('messaging');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists dm_threads (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null,
  user_b uuid not null,
  is_request boolean not null default false,
  accepted_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table dm_threads add column if not exists deleted_at timestamptz;

create unique index if not exists idx_dm_threads_pair_unique on dm_threads (least(user_a, user_b), greatest(user_a, user_b));
create index if not exists idx_dm_threads_user_a on dm_threads (user_a);
create index if not exists idx_dm_threads_user_b on dm_threads (user_b);
create index if not exists idx_dm_threads_deleted_at on dm_threads (deleted_at);

create table if not exists dm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid references dm_threads(id),
  from_user_id uuid not null,
  body text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table dm_messages add column if not exists deleted_at timestamptz;

create index if not exists idx_dm_messages_thread_created on dm_messages (thread_id, created_at desc);
create index if not exists idx_dm_messages_deleted_at on dm_messages (deleted_at);

create table if not exists dm_reads (
  thread_id uuid references dm_threads(id),
  user_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (thread_id, user_id)
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
`;

const run = async () => {
  await pool.query(sql);
  console.log('messaging migrations applied');
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});


