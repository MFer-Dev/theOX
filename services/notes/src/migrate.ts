import { getPool } from '@platform/shared';

const pool = getPool('notes');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null,
  status text not null default 'draft',
  algo_version text not null default 'v1',
  inputs_window text,
  computed_at timestamptz not null default now(),
  created_by uuid not null,
  created_by_generation text,
  created_at timestamptz not null default now()
);

create table if not exists note_versions (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  version int not null,
  body text not null,
  status text not null,
  algo_version text not null default 'v1',
  inputs_window text,
  computed_at timestamptz not null default now(),
  created_by uuid not null,
  created_by_generation text,
  created_at timestamptz not null default now(),
  unique(note_id, version)
);

create table if not exists note_citations (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  citation_type text not null,
  source text,
  url text,
  hash text,
  created_by uuid not null,
  created_by_generation text,
  created_at timestamptz not null default now()
);

create table if not exists note_participants (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  user_id uuid not null,
  generation text,
  role text not null,
  created_at timestamptz not null default now(),
  unique(note_id, user_id, role)
);

create table if not exists note_audit (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  action text not null,
  actor_id uuid,
  actor_generation text,
  detail jsonb,
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

create table if not exists outbox (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  topic text not null,
  payload_json jsonb not null,
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text
);

create index if not exists idx_events_occurred_at on events (occurred_at);
create index if not exists idx_events_type on events (event_type);
create index if not exists idx_events_actor on events (actor_id);
`;

const run = async () => {
  await pool.query(sql);
  console.log('notes migrations applied');
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

