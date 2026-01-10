import { getPool } from '@platform/shared';

const pool = getPool('identity');

// Canonical migration entrypoint (services/identity/package.json uses this file).
// This schema matches services/identity/src/index.ts expectations.
const sql = `
create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  created_at timestamptz not null default now(),
  password_hash text not null,
  generation text,
  is_verified boolean not null default false,
  display_name text,
  bio text,
  avatar_url text,
  deleted_at timestamptz,
  deleted_reason text
);

alter table users add column if not exists display_name text;
alter table users add column if not exists bio text;
alter table users add column if not exists avatar_url text;
alter table users add column if not exists deleted_at timestamptz;
alter table users add column if not exists deleted_reason text;
create index if not exists idx_users_deleted_at on users (deleted_at);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  refresh_token_hash text not null,
  device_fingerprint text,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  revoked_at timestamptz,
  expires_at timestamptz not null
);

alter table sessions add column if not exists device_fingerprint text;
alter table sessions add column if not exists last_active_at timestamptz;
alter table sessions add column if not exists revoked_at timestamptz;
create index if not exists idx_sessions_user_active on sessions (user_id) where revoked_at is null;
create index if not exists idx_sessions_expires_at on sessions (expires_at);

create table if not exists otp_codes (
  id uuid primary key default gen_random_uuid(),
  contact text not null,
  code_hash text not null,
  purpose text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz
);
create index if not exists idx_otp_codes_contact_purpose on otp_codes (contact, purpose, created_at desc);

create table if not exists policy_acceptances (
  user_id uuid references users(id),
  policy_id text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, policy_id)
);

create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  token_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists user_relationships (
  actor_id uuid references users(id),
  subject_id uuid references users(id),
  relation text not null, -- follow | mute | block
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_id, subject_id, relation)
);
create index if not exists idx_user_relationships_actor on user_relationships (actor_id);
create index if not exists idx_user_relationships_subject on user_relationships (subject_id);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  device_fingerprint text,
  attestation_score numeric,
  created_at timestamptz not null default now()
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

async function run() {
  await pool.query(sql);
  console.log('identity migrations applied');
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});


