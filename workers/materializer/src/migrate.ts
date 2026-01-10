import { getPool } from '@platform/shared';

const pool = getPool('materializer');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists timeline_items (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid,
  generation text not null,
  author_id uuid not null,
  topic text,
  assumption_type text,
  body_preview text,
  endorse_count int not null default 0,
  reply_count int not null default 0,
  is_cross_gen_visible boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_timeline_gen_created on timeline_items (generation, created_at desc);
`;

const run = async () => {
  await pool.query(sql);
  console.log('materializer migrations applied');
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

