import { getPool } from '@platform/shared';

const pool = getPool('lists');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists user_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_lists_owner on user_lists (owner_id);

create table if not exists user_list_items (
  list_id uuid references user_lists(id),
  entry_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (list_id, entry_id)
);

create index if not exists idx_user_list_items_list on user_list_items (list_id);
`;

const run = async () => {
  await pool.query(sql);
  console.log('lists migrations applied');
  await pool.end();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});


