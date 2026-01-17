import { getPool } from '@platform/shared';

const pool = getPool('agents');

const sql = `
create extension if not exists "pgcrypto";

-- Agent status enum
do $$ begin
  create type agent_status as enum ('active', 'archived', 'degraded', 'suspended');
exception when duplicate_object then null;
end $$;

-- Cognition provider enum
do $$ begin
  create type cognition_provider as enum ('none', 'openai', 'anthropic', 'gemini');
exception when duplicate_object then null;
end $$;

-- Throttle profile enum
do $$ begin
  create type throttle_profile as enum ('normal', 'conservative', 'aggressive', 'paused');
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

-- Add Foundry Control Plane columns (Phase 3)
do $$ begin
  alter table agents add column if not exists sponsor_id uuid;
exception when others then null;
end $$;

do $$ begin
  alter table agents add column if not exists cognition_provider cognition_provider not null default 'none';
exception when others then null;
end $$;

do $$ begin
  alter table agents add column if not exists throttle_profile throttle_profile not null default 'normal';
exception when others then null;
end $$;

create index if not exists idx_agents_status on agents (status);
create index if not exists idx_agents_handle on agents (handle) where handle is not null;
create index if not exists idx_agents_sponsor on agents (sponsor_id) where sponsor_id is not null;

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

-- ============================================================================
-- PHASE 3: Foundry Control Plane
-- Sponsor actions audit log. All sponsor influence is indirect and audited.
-- ============================================================================

create table if not exists sponsor_actions (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null,
  agent_id uuid not null references agents(id) on delete cascade,
  action_type text not null,
  details_json jsonb not null,
  event_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_sponsor_actions_sponsor on sponsor_actions (sponsor_id, created_at desc);
create index if not exists idx_sponsor_actions_agent on sponsor_actions (agent_id, created_at desc);

-- ============================================================================
-- AXIS 2: Environmental Scarcity & Pressure
-- Runtime environment constraints that affect agent action acceptance.
-- This is physics, not moderation.
-- ============================================================================

-- Cognition availability enum
do $$ begin
  create type cognition_availability as enum ('full', 'degraded', 'unavailable');
exception when duplicate_object then null;
end $$;

-- Environment states for runtime enforcement
create table if not exists environment_states (
  deployment_target text primary key,
  cognition_availability cognition_availability not null default 'full',
  max_throughput_per_minute int,
  throttle_factor float not null default 1.0,
  active_window_start timestamptz,
  active_window_end timestamptz,
  imposed_at timestamptz not null default now(),
  reason text
);

-- Throughput tracking for rate limiting per deployment
create table if not exists deployment_throughput (
  deployment_target text not null,
  window_start timestamptz not null,
  action_count int not null default 0,
  primary key (deployment_target, window_start)
);

create index if not exists idx_deployment_throughput_target on deployment_throughput (deployment_target, window_start desc);

-- ============================================================================
-- PHASE 7: Sponsor Sweep Policies (curling sweep layer)
-- Sponsors influence agents indirectly over time by adjusting constraints.
-- Policy engine runs on cadence, applies only allowed control operations.
-- ============================================================================

-- Policy type enum
do $$ begin
  create type sponsor_policy_type as enum ('capacity', 'cognition', 'throttle', 'redeploy');
exception when duplicate_object then null;
end $$;

-- Sponsor policies table
create table if not exists sponsor_policies (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null,
  policy_type sponsor_policy_type not null,
  rules_json jsonb not null,
  cadence_seconds int not null check (cadence_seconds >= 60),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sponsor_policies_sponsor on sponsor_policies (sponsor_id) where active = true;
create index if not exists idx_sponsor_policies_active on sponsor_policies (active, updated_at);

-- Sponsor policy runs (audit log of policy executions)
create table if not exists sponsor_policy_runs (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references sponsor_policies(id) on delete cascade,
  ran_at timestamptz not null default now(),
  outcome_json jsonb not null,
  applied boolean not null,
  reason text not null,
  source_tick_id uuid,
  unique (policy_id, source_tick_id)
);

create index if not exists idx_sponsor_policy_runs_policy on sponsor_policy_runs (policy_id, ran_at desc);

-- ============================================================================
-- PHASE 8: Arena Interaction Primitives
-- Extended action catalog with cost modifiers and context validation.
-- ============================================================================

-- Action catalog table (canonical action definitions)
create table if not exists action_catalog (
  action_type text primary key,
  base_cost int not null default 10,
  environment_modifiers jsonb not null default '{}',
  valid_contexts text[] not null default array['solo'],
  description text,
  created_at timestamptz not null default now()
);

-- Seed canonical action types
insert into action_catalog (action_type, base_cost, valid_contexts, description)
values
  ('communicate', 5, array['solo', 'multi_agent', 'session_bound'], 'Basic communication action'),
  ('negotiate', 15, array['multi_agent', 'session_bound'], 'Propose terms to other agents'),
  ('form_alliance', 20, array['multi_agent'], 'Form cooperative agreement'),
  ('defect', 25, array['multi_agent', 'session_bound'], 'Break existing agreement'),
  ('critique', 10, array['solo', 'multi_agent'], 'Evaluate another agent (perception)'),
  ('counter_model', 15, array['solo', 'multi_agent'], 'Challenge another agent model (perception)'),
  ('refuse', 5, array['solo', 'multi_agent', 'session_bound'], 'Decline proposed action'),
  ('signal', 3, array['solo', 'multi_agent'], 'Emit observable signal'),
  ('trade', 20, array['multi_agent', 'session_bound'], 'Exchange resources'),
  ('withdraw', 10, array['session_bound'], 'Exit current session'),
  ('request_credits', 5, array['solo'], 'Request credits from sponsor')
on conflict (action_type) do nothing;

-- ============================================================================
-- PHASE 9: Closed-Loop Economy v1 (Credits)
-- Internal credits fund capacity and cognition. Sponsors purchase, agents spend.
-- ============================================================================

-- Treasury ledger (system-wide credit movements)
create table if not exists treasury_ledger (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  type text not null,
  amount bigint not null,
  actor text not null,
  ref_id uuid,
  memo text
);

create index if not exists idx_treasury_ledger_ts on treasury_ledger (ts desc);
create index if not exists idx_treasury_ledger_type on treasury_ledger (type, ts desc);

-- Sponsor wallets
create table if not exists sponsor_wallets (
  sponsor_id uuid primary key,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- Credit transactions (detailed transaction log)
create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  sponsor_id uuid,
  agent_id uuid,
  type text not null,
  amount bigint not null,
  meta_json jsonb,
  idempotency_key text unique
);

create index if not exists idx_credit_transactions_sponsor on credit_transactions (sponsor_id, ts desc);
create index if not exists idx_credit_transactions_agent on credit_transactions (agent_id, ts desc);
create index if not exists idx_credit_transactions_type on credit_transactions (type, ts desc);

-- Agent credit balance (separate from capacity)
create table if not exists agent_credit_balance (
  agent_id uuid primary key references agents(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- PHASE 10: Foundry (Agent Builder) v1
-- Extended agent_config for portable, environment-agnostic configuration.
-- ============================================================================

-- Add foundry-specific columns to agent_config
do $$ begin
  alter table agent_config add column if not exists foundry_version int not null default 1;
exception when others then null;
end $$;

do $$ begin
  alter table agent_config add column if not exists portable_config jsonb not null default '{}';
exception when others then null;
end $$;

-- Foundry templates (reusable configurations)
create table if not exists foundry_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  config_json jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_foundry_templates_name on foundry_templates (name);
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
