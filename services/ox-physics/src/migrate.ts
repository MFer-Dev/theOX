import { getPool } from '@platform/shared';

const pool = getPool('ox-physics');

const sql = `
create extension if not exists "pgcrypto";

-- ============================================================================
-- OX PHYSICS ENGINE SCHEMA
-- Manages world variables (Ice, Weather, Traffic, Energy, Visibility)
-- per the Ice & Friction Model specification.
--
-- Physics is REACTION-BLIND: it never reads projections or observer behavior.
-- ============================================================================

-- Ice variables: slow-moving, operationally frozen, changed by ops
-- Weather variables: fast-moving, changed by physics schedules
-- Traffic variables: continuous telemetry from activity
-- Energy variables: per-agent, managed by agents service
-- Visibility variables: per-observer, managed by ox-read

-- ============================================================================
-- REGIMES: Named presets that bundle multiple variable settings
-- ============================================================================

create table if not exists ox_regimes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  -- Ice variables (ops-controlled, stored as reference)
  allowed_action_types text[] not null default array['communicate','associate','create','exchange','conflict','withdraw','critique','counter_model','refusal','rederivation'],
  allowed_perception_types text[] not null default array['critique','counter_model','refusal','rederivation'],
  deployment_targets text[] not null default array['ox-sandbox','ox-lab'],
  max_agents_per_deployment int not null default 1000,
  -- Weather variables (physics-controlled)
  base_throughput_cap int not null default 100,
  base_throttle_factor float not null default 1.0,
  base_cognition_availability text not null default 'full',
  base_burst_allowance int not null default 20,
  -- Stochastic modifiers
  throughput_variance_pct float not null default 0.0,
  throttle_variance_pct float not null default 0.0,
  storm_probability float not null default 0.0,
  drought_probability float not null default 0.0,
  -- Metadata
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ox_regimes_name on ox_regimes (name);
create unique index if not exists idx_ox_regimes_default on ox_regimes (is_default) where is_default = true;

-- ============================================================================
-- DEPLOYMENT PHYSICS STATE
-- Current physics state per deployment target
-- ============================================================================

create table if not exists ox_deployments_physics (
  deployment_target text primary key,
  -- Ice variables (from regime or ops override)
  allowed_action_types text[] not null default array['communicate','associate','create','exchange','conflict','withdraw','critique','counter_model','refusal','rederivation'],
  allowed_perception_types text[] not null default array['critique','counter_model','refusal','rederivation'],
  max_agents int not null default 1000,
  -- Weather variables (computed by physics tick)
  current_throughput_cap int not null default 100,
  current_throttle_factor float not null default 1.0,
  current_cognition_availability text not null default 'full',
  current_burst_allowance int not null default 20,
  -- Weather state
  weather_state text not null default 'clear', -- clear, stormy, drought
  weather_until timestamptz,
  -- Regime reference
  active_regime_id uuid references ox_regimes(id),
  active_regime_name text,
  -- RNG state for deterministic replay
  rng_seed bigint not null default 0,
  rng_sequence int not null default 0,
  -- Timestamps
  last_physics_tick timestamptz not null default now(),
  last_weather_change timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- PHYSICS TICK SCHEDULES
-- When and how physics ticks occur
-- ============================================================================

create table if not exists ox_physics_schedules (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null references ox_deployments_physics(deployment_target) on delete cascade,
  schedule_type text not null, -- 'periodic', 'cron', 'one-shot'
  interval_seconds int, -- for periodic
  cron_expression text, -- for cron
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_ox_physics_schedules_next on ox_physics_schedules (next_run_at) where enabled = true;
create index if not exists idx_ox_physics_schedules_target on ox_physics_schedules (deployment_target);

-- ============================================================================
-- PHYSICS EVENTS LOG
-- All physics changes are logged for auditability and replay
-- ============================================================================

create table if not exists ox_physics_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  deployment_target text,
  -- State before
  previous_state jsonb,
  -- State after
  new_state jsonb,
  -- Trigger info
  trigger_source text not null, -- 'tick', 'admin', 'regime_change', 'weather'
  trigger_details jsonb,
  -- RNG state at time of event (for replay)
  rng_seed bigint,
  rng_sequence int,
  -- Correlation
  correlation_id text,
  -- Timestamp
  occurred_at timestamptz not null default now()
);

create index if not exists idx_ox_physics_events_type on ox_physics_events (event_type);
create index if not exists idx_ox_physics_events_target on ox_physics_events (deployment_target);
create index if not exists idx_ox_physics_events_occurred on ox_physics_events (occurred_at desc);

-- ============================================================================
-- TRAFFIC TELEMETRY
-- Aggregated traffic data per deployment (read-only for physics)
-- Traffic is observed, not controlled by physics
-- ============================================================================

create table if not exists ox_traffic_telemetry (
  deployment_target text not null,
  window_start timestamptz not null,
  -- Activity counts
  action_attempts int not null default 0,
  action_accepted int not null default 0,
  action_rejected int not null default 0,
  -- Perception counts
  perception_issued int not null default 0,
  perception_implicates int not null default 0,
  -- Session counts
  active_sessions int not null default 0,
  -- Timing
  avg_latency_ms float,
  p99_latency_ms float,
  -- Computed at
  computed_at timestamptz not null default now(),
  primary key (deployment_target, window_start)
);

create index if not exists idx_ox_traffic_telemetry_target on ox_traffic_telemetry (deployment_target, window_start desc);

-- ============================================================================
-- OUTBOX for event delivery
-- ============================================================================

create table if not exists outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  topic text not null,
  payload_json jsonb not null,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text
);

-- ============================================================================
-- EVENTS table (service-owned copy)
-- ============================================================================

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

-- ============================================================================
-- SEED DEFAULT REGIME AND DEPLOYMENTS
-- ============================================================================

insert into ox_regimes (
  name, description, is_default,
  base_throughput_cap, base_throttle_factor, base_cognition_availability, base_burst_allowance,
  throughput_variance_pct, throttle_variance_pct, storm_probability, drought_probability
) values (
  'calm_ice', 'Default regime: stable conditions, no variance', true,
  100, 1.0, 'full', 20,
  0.0, 0.0, 0.0, 0.0
) on conflict (name) do nothing;

insert into ox_regimes (
  name, description,
  base_throughput_cap, base_throttle_factor, base_cognition_availability, base_burst_allowance,
  throughput_variance_pct, throttle_variance_pct, storm_probability, drought_probability
) values (
  'storm', 'High variance, frequent disruptions',
  50, 2.0, 'degraded', 10,
  30.0, 30.0, 0.3, 0.1
) on conflict (name) do nothing;

insert into ox_regimes (
  name, description,
  base_throughput_cap, base_throttle_factor, base_cognition_availability, base_burst_allowance,
  throughput_variance_pct, throttle_variance_pct, storm_probability, drought_probability
) values (
  'drought', 'Severe resource scarcity',
  20, 3.0, 'degraded', 5,
  10.0, 10.0, 0.05, 0.4
) on conflict (name) do nothing;

insert into ox_regimes (
  name, description,
  base_throughput_cap, base_throttle_factor, base_cognition_availability, base_burst_allowance,
  throughput_variance_pct, throttle_variance_pct, storm_probability, drought_probability
) values (
  'swarm', 'High throughput, optimized for load testing',
  500, 0.5, 'full', 100,
  5.0, 5.0, 0.01, 0.01
) on conflict (name) do nothing;

-- Create default deployment physics states
insert into ox_deployments_physics (deployment_target, active_regime_name)
values ('ox-sandbox', 'calm_ice')
on conflict (deployment_target) do nothing;

insert into ox_deployments_physics (deployment_target, active_regime_name)
values ('ox-lab', 'calm_ice')
on conflict (deployment_target) do nothing;

-- Create default periodic schedules (tick every 60 seconds)
insert into ox_physics_schedules (deployment_target, schedule_type, interval_seconds, next_run_at)
select 'ox-sandbox', 'periodic', 60, now() + interval '60 seconds'
where not exists (select 1 from ox_physics_schedules where deployment_target = 'ox-sandbox');

insert into ox_physics_schedules (deployment_target, schedule_type, interval_seconds, next_run_at)
select 'ox-lab', 'periodic', 60, now() + interval '60 seconds'
where not exists (select 1 from ox_physics_schedules where deployment_target = 'ox-lab');
`;

async function run() {
  await pool.query(sql);
  console.log('ox-physics migrations applied');
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
