import { getPool } from '@platform/shared';

const pool = getPool('integrity');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists triage_suggestions (
  report_id uuid primary key,
  suggested_severity text,
  suggested_queue text,
  rationale text,
  created_at timestamptz not null default now()
);

create table if not exists purge_surge_recommendations (
  id uuid primary key default gen_random_uuid(),
  window_id uuid,
  risk_level text,
  recommended_actions jsonb,
  created_at timestamptz not null default now()
);
`;

const run = async () => {
  await pool.query(sql);
  console.log('integrity migrations applied');
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

