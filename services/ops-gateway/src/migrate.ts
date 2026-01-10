import { compareHash, getPool, hashValue } from '@platform/shared';

// Ops gateway schema: audit trail + ops users + sessions + local error inbox.
const pool = getPool('ops');

const sql = `
create extension if not exists "pgcrypto";

create table if not exists ops_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  correlation_id text,
  ops_role text,
  ops_user text,
  action text not null, -- e.g. "users.search" | "users.detail" | "user.action" | "moderation.action"
  target_type text,
  target_id text,
  reason text,
  meta jsonb
);

create index if not exists idx_ops_audit_occurred_at on ops_audit_log (occurred_at desc);
create index if not exists idx_ops_audit_action on ops_audit_log (action);
create index if not exists idx_ops_audit_target on ops_audit_log (target_type, target_id);

create table if not exists ops_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists ops_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references ops_users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists idx_ops_sessions_user on ops_sessions (user_id, created_at desc);
create index if not exists idx_ops_sessions_active on ops_sessions (expires_at) where revoked_at is null;

create table if not exists ops_errors (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null,
  service text,
  route text,
  status int,
  message text,
  sample_correlation_id text,
  count int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  meta jsonb
);
create unique index if not exists idx_ops_errors_fingerprint on ops_errors (fingerprint);
create index if not exists idx_ops_errors_last_seen on ops_errors (last_seen_at desc);
`;

async function run() {
  await pool.query(sql);

  // Seed a local admin user (dev only).
  const seedEmail = process.env.OPS_SEED_EMAIL ?? 'admin@example.com';
  const seedPassword = process.env.OPS_SEED_PASSWORD ?? 'admin';
  const seedRole = process.env.OPS_SEED_ROLE ?? 'core_ops';
  if (process.env.NODE_ENV !== 'production') {
    const existing = await pool.query('select id, password_hash from ops_users where email=$1', [seedEmail]);
    if (!existing.rowCount) {
      const hash = await hashValue(seedPassword);
      await pool.query('insert into ops_users (email, role, password_hash) values ($1,$2,$3)', [seedEmail, seedRole, hash]);
      // eslint-disable-next-line no-console
      console.log(`seeded ops user ${seedEmail} role=${seedRole}`);
    } else {
      // keep password stable across runs if env changed
      const ok = await compareHash(seedPassword, existing.rows[0].password_hash);
      if (!ok) {
        const hash = await hashValue(seedPassword);
        await pool.query('update ops_users set password_hash=$2 where id=$1', [existing.rows[0].id, hash]);
        // eslint-disable-next-line no-console
        console.log(`updated ops user password for ${seedEmail}`);
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('ops-gateway migrations applied');
  await pool.end();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


