import { getPool } from '@platform/shared';

const pool = getPool('discourse');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  generation text not null,
  topic text,
  assumption_type text not null,
  body text not null,
  quote_entry_id uuid,
  ai_assisted boolean not null default false,
  media jsonb not null default '[]'::jsonb,
  reply_count int not null default 0,
  like_count int not null default 0,
  repost_count int not null default 0,
  bookmark_count int not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- Ensure columns exist if this table was created by an older migration.
alter table entries add column if not exists topic text;
alter table entries add column if not exists quote_entry_id uuid;
alter table entries add column if not exists ai_assisted boolean not null default false;
alter table entries add column if not exists media jsonb not null default '[]'::jsonb;
alter table entries add column if not exists reply_count int not null default 0;
alter table entries add column if not exists like_count int not null default 0;
alter table entries add column if not exists repost_count int not null default 0;
alter table entries add column if not exists bookmark_count int not null default 0;
alter table entries add column if not exists deleted_at timestamptz;

create table if not exists replies (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references entries(id),
  user_id uuid not null,
  generation text not null,
  body text not null,
  like_count int not null default 0,
  repost_count int not null default 0,
  bookmark_count int not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table replies add column if not exists like_count int not null default 0;
alter table replies add column if not exists repost_count int not null default 0;
alter table replies add column if not exists bookmark_count int not null default 0;
alter table replies add column if not exists deleted_at timestamptz;

-- Media objects (dev/local storage). In production, store object keys + metadata (S3/GCS).
create table if not exists media_objects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  content_type text not null,
  filename text,
  byte_size int,
  storage_path text not null,
  provider text not null default 'local',
  object_key text,
  public_url text,
  status text not null default 'uploaded', -- planned | uploaded | failed
  moderation_status text not null default 'pending', -- pending | approved | rejected
  thumb_small_url text,
  thumb_medium_url text,
  thumb_large_url text,
  created_at timestamptz not null default now()
);

alter table media_objects add column if not exists provider text not null default 'local';
alter table media_objects add column if not exists object_key text;
alter table media_objects add column if not exists public_url text;
alter table media_objects add column if not exists status text not null default 'uploaded';
alter table media_objects add column if not exists moderation_status text not null default 'pending';
alter table media_objects add column if not exists thumb_small_url text;
alter table media_objects add column if not exists thumb_medium_url text;
alter table media_objects add column if not exists thumb_large_url text;

create index if not exists idx_media_objects_user on media_objects (user_id, created_at desc);

create table if not exists media_jobs (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null,
  job_type text not null, -- thumbnail | moderate
  status text not null default 'queued', -- queued | running | done | failed
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_media_jobs_status on media_jobs (status, created_at desc);

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

create table if not exists timeline_items (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid,
  generation text not null,
  author_id uuid not null,
  topic text,
  assumption_type text,
  body_preview text,
  quote_entry_id uuid,
  endorse_count int not null default 0,
  reply_count int not null default 0,
  like_count int not null default 0,
  repost_count int not null default 0,
  bookmark_count int not null default 0,
  ai_assisted boolean not null default false,
  media_preview jsonb not null default '[]'::jsonb,
  is_cross_gen_visible boolean not null default false,
  created_at timestamptz not null default now()
);

alter table timeline_items add column if not exists topic text;
alter table timeline_items add column if not exists quote_entry_id uuid;
alter table timeline_items add column if not exists like_count int not null default 0;
alter table timeline_items add column if not exists repost_count int not null default 0;
alter table timeline_items add column if not exists bookmark_count int not null default 0;
alter table timeline_items add column if not exists ai_assisted boolean not null default false;
alter table timeline_items add column if not exists media_preview jsonb not null default '[]'::jsonb;

create table if not exists entry_interactions (
  entry_id uuid references entries(id),
  user_id uuid not null,
  kind text not null, -- like | repost | bookmark
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id, kind)
);

create index if not exists idx_entry_interactions_user on entry_interactions (user_id, kind);

create table if not exists reply_interactions (
  reply_id uuid references replies(id),
  user_id uuid not null,
  kind text not null, -- like | repost | bookmark
  created_at timestamptz not null default now(),
  primary key (reply_id, user_id, kind)
);

create index if not exists idx_reply_interactions_user on reply_interactions (user_id, kind);

create index if not exists idx_timeline_gen_created on timeline_items (generation, created_at desc);
create unique index if not exists idx_timeline_entry_unique on timeline_items (entry_id);

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
  console.log('discourse migrations applied');
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

