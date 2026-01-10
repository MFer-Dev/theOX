import { getPool } from '@platform/shared';

const pool = getPool('safety');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table if not exists moderation_actions (
  id uuid primary key default gen_random_uuid(),
  actor_ops_id text not null,
  target_type text not null,
  target_id uuid not null,
  action text not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  ref_event_id uuid
);

create table if not exists safety_flags (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  status text not null default 'open',
  algo_version text not null default 'v1',
  inputs_window text,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_generation text
);

create table if not exists safety_friction (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  friction_type text not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  algo_version text not null default 'v1',
  inputs_window text,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_generation text
);

create table if not exists safety_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  reason text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists safety_appeals (
  id uuid primary key default gen_random_uuid(),
  flag_id uuid,
  friction_id uuid,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  message text,
  status text not null default 'open',
  resolution text,
  decided_by uuid,
  decided_at timestamptz,
  algo_version text not null default 'v1',
  inputs_window text,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_generation text
);

alter table safety_appeals add column if not exists flag_id uuid;
alter table safety_appeals add column if not exists friction_id uuid;
alter table safety_appeals add column if not exists message text;

create index if not exists idx_safety_appeals_created_at on safety_appeals (created_at desc);
create index if not exists idx_safety_appeals_status on safety_appeals (status);
create index if not exists idx_safety_appeals_target on safety_appeals (target_type, target_id);
create index if not exists idx_safety_appeals_flag on safety_appeals (flag_id);
create index if not exists idx_safety_appeals_friction on safety_appeals (friction_id);

create table if not exists safety_audit (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  action text not null,
  actor_id uuid,
  actor_generation text,
  detail jsonb,
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

create table if not exists triage_suggestions (
  report_id uuid primary key,
  suggested_severity text,
  suggested_queue text,
  rationale text,
  created_at timestamptz not null default now()
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
`;

const run = async () => {
  await pool.query(sql);
  console.log('safety migrations applied');
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

