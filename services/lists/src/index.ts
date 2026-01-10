import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ensureCorrelationId, verifyAccess, getPool, rateLimitMiddleware } from '@platform/shared';

const app = Fastify({ logger: true });
const pool = getPool('lists');
const purgeUrl = process.env.PURGE_URL ?? 'http://localhost:4003';

const discourseUrl = process.env.DISCOURSE_URL ?? 'http://localhost:4002';
const identityUrl = process.env.IDENTITY_URL ?? 'http://localhost:4001';

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, { openapi: { info: { title: 'Lists Service', version: '0.1.0' } } });
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));

const getAuth = (request: any) => {
  const header = request.headers.authorization;
  if (!header) return null;
  return verifyAccess(header.replace('Bearer ', ''));
};

const rlKey = (request: any, auth: any, action: string) => {
  const device =
    (request.headers['x-device-id'] as string | undefined) ??
    (request.headers['x-device-fingerprint'] as string | undefined) ??
    'unknown';
  const ip = (request.ip as string | undefined) ?? (request.headers['x-forwarded-for'] as string | undefined) ?? 'unknown';
  return `lists:${action}:${auth?.sub ?? 'anon'}:${device}:${ip}`;
};

type PurgeStatus = {
  active: boolean;
  status?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  last_starts_at?: string | null;
  last_ends_at?: string | null;
};

const getPurgeStatus = async (): Promise<PurgeStatus> => {
  try {
    const res = await fetch(`${purgeUrl}/purge/status`);
    return (await res.json()) as PurgeStatus;
  } catch {
    return { active: false, ends_at: null, last_ends_at: null, starts_at: null, last_starts_at: null };
  }
};

const maybeRejectGatheringEnded = async (request: any, reply: any) => {
  const hdr = (request.headers['x-trybl-world'] ?? request.headers['x-world']) as string | undefined;
  const wantsGathering = (hdr ?? '').toLowerCase() === 'gathering';
  if (!wantsGathering) return false;
  const purge = await getPurgeStatus();
  const now = Date.now();
  const endsAt = purge.ends_at ? new Date(purge.ends_at).getTime() : null;
  const lastEndsAt = purge.last_ends_at ? new Date(purge.last_ends_at).getTime() : null;
  if (typeof endsAt === 'number' && Number.isFinite(endsAt) && now > endsAt) {
    reply.status(410);
    return { error: 'gathering_ended', ends_at: purge.ends_at ?? null };
  }
  if (typeof lastEndsAt === 'number' && Number.isFinite(lastEndsAt) && now > lastEndsAt) {
    const graceMs = 10 * 60_000;
    if (now - lastEndsAt <= graceMs) {
      reply.status(410);
      return { error: 'gathering_ended', ends_at: purge.last_ends_at ?? null };
    }
  }
  return false;
};

const getEntry = async (entryId: string) => {
  const res = await fetch(`${discourseUrl}/internal/entries/${encodeURIComponent(entryId)}`, {
    headers: { 'x-internal-call': 'true' },
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  return json?.entry ?? null;
};

const getAuthor = async (userId: string) => {
  const res = await fetch(`${identityUrl}/internal/users/${encodeURIComponent(userId)}`, {
    headers: { 'x-internal-call': 'true' },
  });
  if (!res.ok) return null;
  const json: any = await res.json();
  const u = json?.user;
  return u ? { handle: u.handle, display_name: u.display_name ?? u.handle, avatar_url: u.avatar_url ?? null } : null;
};

app.get('/lists', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const rows = await pool.query('select * from user_lists where owner_id=$1 order by updated_at desc', [auth.sub]);
  const items = await pool.query(
    'select list_id, count(*)::int as c from user_list_items where list_id = any($1::uuid[]) group by list_id',
    [rows.rows.map((r: any) => r.id)],
  );
  const counts = new Map(items.rows.map((r: any) => [r.list_id, r.c]));
  return {
    lists: rows.rows.map((l: any) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      itemCount: counts.get(l.id) ?? 0,
    })),
  };
});

app.post('/lists', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: rlKey(request, auth, 'create'), limit: 30, windowSec: 60 })(request, reply);
  if ((reply as any).sent) return reply;
  const ended = await maybeRejectGatheringEnded(request, reply);
  if (ended) return ended;
  const body = request.body as { name?: string; description?: string };
  if (!body.name) {
    reply.status(400);
    return { error: 'name required' };
  }
  const row = await pool.query(
    'insert into user_lists (owner_id, name, description) values ($1,$2,$3) returning *',
    [auth.sub, body.name, body.description ?? null],
  );
  return { list: row.rows[0] };
});

app.get('/lists/:id', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const id = (request.params as any).id as string;
  const row = await pool.query('select * from user_lists where id=$1 and owner_id=$2', [id, auth.sub]);
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not found' };
  }
  const items = await pool.query('select entry_id from user_list_items where list_id=$1 order by created_at desc', [id]);
  return { list: { ...row.rows[0], itemIds: items.rows.map((r: any) => r.entry_id) } };
});

// Update list metadata (name/description). Write is world-gated.
app.post('/lists/:id', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: rlKey(request, auth, 'update'), limit: 60, windowSec: 60 })(request, reply);
  if ((reply as any).sent) return reply;
  const ended = await maybeRejectGatheringEnded(request, reply);
  if (ended) return ended;
  const id = (request.params as any).id as string;
  const body = request.body as { name?: string; description?: string };
  if (!body?.name) {
    reply.status(400);
    return { error: 'name required' };
  }
  const exists = await pool.query('select 1 from user_lists where id=$1 and owner_id=$2', [id, auth.sub]);
  if (!exists.rowCount) {
    reply.status(404);
    return { error: 'not found' };
  }
  const row = await pool.query(
    'update user_lists set name=$3, description=$4, updated_at=now() where id=$1 and owner_id=$2 returning *',
    [id, auth.sub, body.name, body.description ?? null],
  );
  return { list: row.rows[0] };
});

app.post('/lists/:id/items', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: rlKey(request, auth, 'add_item'), limit: 120, windowSec: 60 })(request, reply);
  if ((reply as any).sent) return reply;
  const ended = await maybeRejectGatheringEnded(request, reply);
  if (ended) return ended;
  const id = (request.params as any).id as string;
  const body = request.body as { entry_id?: string };
  if (!body.entry_id) {
    reply.status(400);
    return { error: 'entry_id required' };
  }
  const exists = await pool.query('select 1 from user_lists where id=$1 and owner_id=$2', [id, auth.sub]);
  if (!exists.rowCount) {
    reply.status(404);
    return { error: 'not found' };
  }
  await pool.query(
    `insert into user_list_items (list_id, entry_id) values ($1,$2)
     on conflict (list_id, entry_id) do nothing`,
    [id, body.entry_id],
  );
  await pool.query('update user_lists set updated_at=now() where id=$1', [id]);
  return { ok: true };
});

app.delete('/lists/:id/items/:entryId', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: rlKey(request, auth, 'remove_item'), limit: 120, windowSec: 60 })(request, reply);
  if ((reply as any).sent) return reply;
  const ended = await maybeRejectGatheringEnded(request, reply);
  if (ended) return ended;
  const id = (request.params as any).id as string;
  const entryId = (request.params as any).entryId as string;
  const exists = await pool.query('select 1 from user_lists where id=$1 and owner_id=$2', [id, auth.sub]);
  if (!exists.rowCount) {
    reply.status(404);
    return { error: 'not found' };
  }
  await pool.query('delete from user_list_items where list_id=$1 and entry_id=$2', [id, entryId]);
  await pool.query('update user_lists set updated_at=now() where id=$1', [id]);
  return { ok: true };
});

app.get('/lists/:id/timeline', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const id = (request.params as any).id as string;
  const row = await pool.query('select * from user_lists where id=$1 and owner_id=$2', [id, auth.sub]);
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not found' };
  }
  const items = await pool.query('select entry_id from user_list_items where list_id=$1 order by created_at desc limit 200', [id]);
  const entries = await Promise.all(
    items.rows.map(async (r: any) => {
      const entry = await getEntry(r.entry_id);
      if (!entry) return null;
      const author = await getAuthor(entry.user_id);
      return { ...entry, author };
    }),
  );
  return { list: row.rows[0], feed: entries.filter(Boolean) };
});

const start = async () => {
  const port = Number(process.env.PORT ?? 4012);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`lists running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start lists');
  process.exit(1);
});


