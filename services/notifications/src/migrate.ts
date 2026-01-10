import { getPool } from '@platform/shared';

const pool = getPool('notifications');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  platform text not null, -- ios | android
  token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists idx_push_devices_platform_token on push_devices (platform, token);
create index if not exists idx_push_devices_user on push_devices (user_id) where revoked_at is null;

create table if not exists push_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_type text,
  payload jsonb,
  status text not null default 'queued', -- queued | sent | failed | skipped
  last_error text
);
create index if not exists idx_push_jobs_status on push_jobs (status, created_at desc);
`;

async function run() {
  await pool.query(sql);
  console.log('notifications migrations applied');
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});


