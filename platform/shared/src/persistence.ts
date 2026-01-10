import { Pool, PoolConfig } from 'pg';

const pools: Record<string, Pool> = {};

export const getPool = (service: string, config?: PoolConfig): Pool => {
  if (!pools[service]) {
    const connectionString =
      config?.connectionString ||
      process.env.DATABASE_URL ||
      `postgresql://${process.env.POSTGRES_USER || 'genme_local'}:${
        process.env.POSTGRES_PASSWORD || 'genme_local_password'
      }@${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || 5433}/${
        process.env.POSTGRES_DB || 'genme_local'
      }`;
    pools[service] = new Pool({ connectionString, ...config });
  }
  return pools[service];
};

export type IdempotencyRecord = {
  idempotency_key: string;
  response_body: unknown;
  created_at: string;
};

export const withIdempotency = async <T>(
  pool: Pool,
  key: string | undefined,
  action: () => Promise<T>,
): Promise<T> => {
  if (!key) {
    return action();
  }
  const existing = await pool.query('select response_body from idempotency_keys where idempotency_key=$1', [
    key,
  ]);
  if (existing.rows.length > 0) {
    return existing.rows[0].response_body as T;
  }
  const result = await action();
  await pool.query(
    'insert into idempotency_keys (idempotency_key, response_body) values ($1, $2) on conflict (idempotency_key) do nothing',
    [key, result],
  );
  return result;
};

export const recordOutbox = async (
  pool: Pool,
  topic: string,
  eventId: string,
  payload: unknown,
): Promise<void> => {
  await pool.query(
    `insert into outbox (id, event_id, topic, payload_json, attempts, next_attempt_at)
     values (gen_random_uuid(), $1, $2, $3, 0, now())`,
    [eventId, topic, JSON.stringify(payload)],
  );
};

export const dispatchOutbox = async (pool: Pool, publisher: (topic: string, payload: any) => Promise<void>) => {
  const rows = await pool.query(
    'select id, topic, payload_json, attempts from outbox where next_attempt_at <= now() order by next_attempt_at asc limit 50',
  );
  for (const row of rows.rows) {
    try {
      await publisher(row.topic, row.payload_json);
      await pool.query('delete from outbox where id=$1', [row.id]);
    } catch (err: any) {
      const next = new Date(Date.now() + 5 * 1000);
      await pool.query(
        'update outbox set attempts=attempts+1, last_error=$2, next_attempt_at=$3 where id=$1',
        [row.id, err?.message || 'publish failed', next],
      );
    }
  }
};

