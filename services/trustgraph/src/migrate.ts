import { getPool } from '@platform/shared';

const pool = getPool('trustgraph');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists trust_nodes (
  user_id uuid not null,
  generation text not null,
  credibility_score numeric not null default 0,
  cross_gen_delta numeric not null default 0,
  volatility_index numeric not null default 0,
  endorsement_quality_ratio numeric not null default 0,
  same_gen_endorsements int not null default 0,
  cross_gen_endorsements int not null default 0,
  purge_cross_gen_endorsements int not null default 0,
  algo_version text not null default 'v1',
  inputs_window text,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, generation)
);

create table if not exists trust_edges (
  id uuid primary key default gen_random_uuid(),
  src_user_id uuid not null,
  dest_user_id uuid,
  dest_generation text,
  weight numeric not null,
  context jsonb,
  algo_version text not null default 'v1',
  inputs_window text,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists trust_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  generation text not null,
  metric text not null,
  value numeric not null,
  window_label text not null default 'event',
  algo_version text not null default 'v1',
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists trust_events (
  event_id uuid primary key,
  event_type text not null,
  actor_id uuid,
  actor_generation text,
  occurred_at timestamptz not null,
  payload jsonb not null
);

create table if not exists trust_processed_events (
  event_id uuid primary key,
  processed_at timestamptz not null default now()
);

create table if not exists trust_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  signal_type text not null,
  value jsonb,
  created_at timestamptz not null default now(),
  ref_event_id uuid
);

create table if not exists user_trust_view (
  user_id uuid primary key,
  qualitative jsonb,
  updated_at timestamptz not null default now()
);

-- --- Semantic Layer (derived-only, covenant-safe) ---
-- Aggregates by concept (topic) and cohort. Never store user_id here.
create table if not exists semantic_topic_generation_daily (
  day date not null,
  topic text not null,
  generation text not null,
  posts int not null default 0,
  replies int not null default 0,
  endorsements int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (day, topic, generation)
);

create table if not exists semantic_topic_volatility_daily (
  day date not null,
  topic text not null,
  volatility numeric not null default 0,
  posts int not null default 0,
  replies int not null default 0,
  endorsements int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (day, topic)
);

create table if not exists semantic_gathering_impact_hourly (
  hour timestamptz not null,
  active boolean not null,
  posts int not null default 0,
  replies int not null default 0,
  endorsements int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (hour)
);

create index if not exists idx_sem_topic_gen_daily_topic on semantic_topic_generation_daily (topic, day desc);
create index if not exists idx_sem_topic_vol_daily_topic on semantic_topic_volatility_daily (topic, day desc);
create index if not exists idx_sem_gather_hour on semantic_gathering_impact_hourly (hour desc);

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
create index if not exists idx_events_actor_id on events (actor_id);
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
`;

const run = async () => {
  await pool.query(sql);
  console.log('trustgraph migrations applied');
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

