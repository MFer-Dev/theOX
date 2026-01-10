import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  ensureCorrelationId,
  verifyAccess,
  getPool,
  withIdempotency,
  recordOutbox,
  dispatchOutbox,
  GenerationCohort,
  rateLimitMiddleware,
} from '@platform/shared';
import { buildEvent, persistEvent, publishEvent } from '@platform/events';

const app = Fastify({ logger: true });
const pool = getPool('messaging');
const identityPool = getPool('identity');
const purgeUrl = process.env.PURGE_URL ?? 'http://localhost:4003';

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, { openapi: { info: { title: 'Messaging Service', version: '0.1.0' } } });
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
  return `messaging:${action}:${auth?.sub ?? 'anon'}:${device}:${ip}`;
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

const appendEvent = async (
  type: string,
  payload: unknown,
  actorId: string,
  actorGeneration?: GenerationCohort | null,
  correlationId?: string,
  idempotencyKey?: string,
) => {
  const evt = buildEvent(type, payload, {
    actorId,
    actorGeneration: actorGeneration ?? undefined,
    correlationId,
  });
  await persistEvent(pool, evt, { idempotencyKey, context: payload as Record<string, unknown> });
  const topic = 'events.messaging.v1';
  try {
    await publishEvent(topic, evt);
  } catch (err: any) {
    await recordOutbox(pool, topic, evt.event_id, evt);
  }
  return evt;
};

const getUserById = async (id: string) => {
  const res = await identityPool.query('select id, handle, display_name, avatar_url from users where id=$1 and deleted_at is null', [
    id,
  ]);
  return res.rowCount ? res.rows[0] : null;
};

const getUserByHandle = async (handle: string) => {
  const res = await identityPool.query(
    'select id, handle, display_name, avatar_url from users where handle=$1 and deleted_at is null',
    [handle],
  );
  return res.rowCount ? res.rows[0] : null;
};

const ensureReadRow = async (threadId: string, userId: string) => {
  await pool.query(
    `insert into dm_reads (thread_id, user_id, last_read_at) values ($1,$2,now())
     on conflict (thread_id, user_id) do update set last_read_at=excluded.last_read_at`,
    [threadId, userId],
  );
};

const threadSummaryFor = async (thread: any, viewerId: string) => {
  const otherId = thread.user_a === viewerId ? thread.user_b : thread.user_a;
  const other = await getUserById(otherId);
  const last = await pool.query(
    'select body, created_at from dm_messages where thread_id=$1 and deleted_at is null order by created_at desc limit 1',
    [thread.id],
  );
  const lastBody = last.rows[0]?.body ?? '';
  const lastTs = last.rows[0]?.created_at ? 'now' : '';
  const reads = await pool.query('select last_read_at from dm_reads where thread_id=$1 and user_id=$2', [thread.id, viewerId]);
  const lastRead = reads.rows[0]?.last_read_at ? new Date(reads.rows[0].last_read_at).getTime() : 0;
  const unreadRes = await pool.query(
    'select count(*)::int as c from dm_messages where thread_id=$1 and deleted_at is null and created_at > to_timestamp($2 / 1000.0)',
    [thread.id, lastRead],
  );
  const unread = unreadRes.rows[0]?.c ?? 0;
  return {
    id: thread.id,
    name: other?.display_name ?? other?.handle ?? 'User',
    handle: other?.handle ?? 'unknown',
    lastBody,
    lastTs,
    unread,
    isRequest: Boolean(thread.is_request) && !thread.accepted_at,
  };
};

// List threads for the current user.
// GET /messaging/threads?filter=all|unread|requests
app.get('/threads', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const filter = String((request.query as any)?.filter ?? 'all');
  const rows = await pool.query(
    'select * from dm_threads where deleted_at is null and (user_a=$1 or user_b=$1) order by updated_at desc limit 100',
    [auth.sub],
  );
  const summaries = await Promise.all(rows.rows.map((t: any) => threadSummaryFor(t, auth.sub)));
  const filtered =
    filter === 'requests'
      ? summaries.filter((t) => t.isRequest)
      : filter === 'unread'
        ? summaries.filter((t) => (t.unread ?? 0) > 0 && !t.isRequest)
        : summaries.filter((t) => (filter === 'all' ? !t.isRequest : true));
  return { threads: filtered };
});

app.get('/threads/:id', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const id = (request.params as any).id as string;
  const row = await pool.query('select * from dm_threads where deleted_at is null and id=$1 and (user_a=$2 or user_b=$2)', [
    id,
    auth.sub,
  ]);
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not found' };
  }
  return { thread: await threadSummaryFor(row.rows[0], auth.sub) };
});

app.get('/threads/:id/messages', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const id = (request.params as any).id as string;
  const row = await pool.query('select * from dm_threads where deleted_at is null and id=$1 and (user_a=$2 or user_b=$2)', [
    id,
    auth.sub,
  ]);
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not found' };
  }
  const msgs = await pool.query(
    'select * from dm_messages where thread_id=$1 and deleted_at is null order by created_at desc limit 200',
    [id],
  );
  return {
    messages: msgs.rows.map((m: any) => ({
      id: m.id,
      threadId: m.thread_id,
      from: m.from_user_id === auth.sub ? 'me' : 'them',
      body: m.body,
      ts: 'now',
    })),
  };
});

app.post('/threads/:id/read', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: rlKey(request, auth, 'read'), limit: 120, windowSec: 60 })(request, reply);
  if ((reply as any).sent) return reply;
  const id = (request.params as any).id as string;
  const row = await pool.query('select id from dm_threads where deleted_at is null and id=$1 and (user_a=$2 or user_b=$2)', [
    id,
    auth.sub,
  ]);
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not found' };
  }
  await ensureReadRow(id, auth.sub);
  return { ok: true };
});

app.post('/threads/:id/accept', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: rlKey(request, auth, 'accept'), limit: 30, windowSec: 60 })(request, reply);
  if ((reply as any).sent) return reply;
  const ended = await maybeRejectGatheringEnded(request, reply);
  if (ended) return ended;
  const id = (request.params as any).id as string;
  const row = await pool.query('select * from dm_threads where deleted_at is null and id=$1 and (user_a=$2 or user_b=$2)', [
    id,
    auth.sub,
  ]);
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not found' };
  }
  await pool.query('update dm_threads set is_request=false, accepted_at=now(), updated_at=now() where id=$1', [id]);
  return { ok: true };
});

app.post('/threads/:id/decline', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: rlKey(request, auth, 'decline'), limit: 30, windowSec: 60 })(request, reply);
  if ((reply as any).sent) return reply;
  const ended = await maybeRejectGatheringEnded(request, reply);
  if (ended) return ended;
  const id = (request.params as any).id as string;
  const row = await pool.query('select * from dm_threads where deleted_at is null and id=$1 and (user_a=$2 or user_b=$2)', [
    id,
    auth.sub,
  ]);
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not found' };
  }
  await pool.query('update dm_messages set deleted_at=now() where thread_id=$1', [id]);
  await pool.query('update dm_threads set deleted_at=now(), updated_at=now() where id=$1', [id]);
  return { ok: true };
});

// Create a thread or send in existing thread.
// POST /messaging/send { to_handle, body }  (creates request thread by default)
app.post('/send', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({
    key: rlKey(request, auth, 'send'),
    limit: 30,
    windowSec: 60,
    cooldownSec: 300,
    cooldownThreshold: 45,
  })(request, reply);
  if ((reply as any).sent) return reply;
  const ended = await maybeRejectGatheringEnded(request, reply);
  if (ended) return ended;
  const body = request.body as { to_handle?: string; thread_id?: string; body?: string };
  if (!body.body || (!body.thread_id && !body.to_handle)) {
    reply.status(400);
    return { error: 'body and (thread_id or to_handle) required' };
  }
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;

  const result = await withIdempotency(pool, idempotencyKey, async () => {
    let threadId = body.thread_id ?? null;
    if (!threadId) {
      const u = await getUserByHandle(body.to_handle!);
      if (!u) {
        reply.status(404);
        return { error: 'user not found' } as any;
      }
      const a = auth.sub;
      const b = u.id;
      const existing = await pool.query(
        'select * from dm_threads where deleted_at is null and least(user_a,user_b)=least($1,$2) and greatest(user_a,user_b)=greatest($1,$2) limit 1',
        [a, b],
      );
      if (existing.rowCount) {
        threadId = existing.rows[0].id;
      } else {
        const created = await pool.query(
          'insert into dm_threads (user_a, user_b, is_request) values ($1,$2,true) returning *',
          [a, b],
        );
        threadId = created.rows[0].id;
      }
    }
    await pool.query('insert into dm_messages (thread_id, from_user_id, body) values ($1,$2,$3)', [
      threadId,
      auth.sub,
      body.body,
    ]);
    await pool.query('update dm_threads set updated_at=now() where id=$1', [threadId]);
    await appendEvent('messaging.message_sent', { thread_id: threadId }, auth.sub, auth.generation, correlationId, idempotencyKey);
    return { ok: true, thread_id: threadId };
  });

  return result;
});

setInterval(() => {
  dispatchOutbox(pool, async (topic, payload) => publishEvent(topic, payload));
}, 10000);

const start = async () => {
  const port = Number(process.env.PORT ?? 4011);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`messaging running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start messaging');
  process.exit(1);
});


