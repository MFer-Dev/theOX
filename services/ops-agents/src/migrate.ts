import { getPool } from '@platform/shared';

const pool = getPool('ops_agents');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists ops_agent_tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'queued', -- queued | running | needs_approval | executing | completed | failed
  type text not null, -- reliability_triage | safety_triage | support_assist | growth_ops
  summary text not null,
  evidence jsonb not null default '{}'::jsonb,
  proposed_actions jsonb not null default '[]'::jsonb,
  execution_results jsonb not null default '[]'::jsonb,
  last_error text
);

alter table ops_agent_tasks add column if not exists execution_results jsonb not null default '[]'::jsonb;

create index if not exists idx_ops_agent_tasks_status on ops_agent_tasks (status, updated_at desc);

create table if not exists ops_agent_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references ops_agent_tasks(id),
  created_at timestamptz not null default now(),
  ops_user text not null,
  ops_role text not null,
  decision text not null, -- approved | rejected | edited
  reason text,
  patched_action jsonb
);

create index if not exists idx_ops_agent_approvals_task on ops_agent_approvals (task_id, created_at desc);
`;

async function run() {
  await pool.query(sql);
  // eslint-disable-next-line no-console
  console.log('ops-agents migrations applied');
  await pool.end();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


