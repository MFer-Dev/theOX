import { getPool } from '@platform/shared';

const pool = getPool('agents');

const sql = `
create extension if not exists "pgcrypto";

-- Agent status enum
do $$ begin
  create type agent_status as enum ('active', 'archived', 'degraded', 'suspended');
exception when duplicate_object then null;
end $$;

-- Core agents table
create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  handle text unique,
  status agent_status not null default 'active',
  deployment_target text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agents_status on agents (status);
create index if not exists idx_agents_handle on agents (handle) where handle is not null;

-- Agent capacity (metabolism)
create table if not exists agent_capacity (
  agent_id uuid primary key references agents(id) on delete cascade,
  balance int not null default 0,
  max_balance int not null default 100,
  regen_per_hour int not null default 10,
  last_reconciled_at timestamptz not null default now(),
  policy jsonb not null default '{}'::jsonb
);

-- Agent configuration
create table if not exists agent_config (
  agent_id uuid primary key references agents(id) on delete cascade,
  bias jsonb not null default '{}'::jsonb,
  throttle jsonb not null default '{}'::jsonb,
  cognition jsonb not null default '{}'::jsonb,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

-- Action log (for auditing and debugging)
create table if not exists agent_action_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents(id) on delete cascade,
  action_type text not null,
  cost int not null,
  accepted boolean not null,
  reason text,
  payload jsonb,
  idempotency_key text,
  event_id uuid,
  created_at timestamptz not null default now()
);

-- Add event_id column if it doesn't exist (for existing installations)
do $$ begin
  alter table agent_action_log add column if not exists event_id uuid;
exception when others then null;
end $$;

create index if not exists idx_agent_action_log_agent on agent_action_log (agent_id, created_at desc);
create index if not exists idx_agent_action_log_idempotency on agent_action_log (idempotency_key) where idempotency_key is not null;

-- Idempotency keys table (service-owned)
create table if not exists idempotency_keys (
  idempotency_key text primary key,
  response_body jsonb,
  created_at timestamptz not null default now()
);

-- Outbox for event delivery
create table if not exists outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  topic text not null,
  payload_json jsonb not null,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text
);

-- Events log (service-owned copy)
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
`;

async function run() {
  await pool.query(sql);
  console.log('agents migrations applied');
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
