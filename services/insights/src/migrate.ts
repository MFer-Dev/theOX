import { getPool } from '@platform/shared';

const pool = getPool('insights');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists insight_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  status text not null default 'pending',
  parameters jsonb,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  algo_version text not null default 'v1',
  inputs_window text,
  computed_at timestamptz
);

create table if not exists insight_cache (
  id uuid primary key default gen_random_uuid(),
  product text not null,
  key text not null,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  algo_version text not null default 'v1',
  inputs_window text,
  unique(product, key)
);
`;

const run = async () => {
  await pool.query(sql);
  console.log('insights migrations applied');
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});


