import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  ensureCorrelationId,
  verifyAccess,
  getPool,
  withIdempotency,
  EndorseIntent,
  GenerationCohort,
  recordOutbox,
  dispatchOutbox,
  rateLimitMiddleware,
} from '@platform/shared';
import { buildEvent, persistEvent, publishEvent } from '@platform/events';

const pool = getPool('endorse');
const credUrl = process.env.CRED_URL ?? 'http://localhost:4004';
const discourseUrl = process.env.DISCOURSE_URL ?? 'http://localhost:4002';
const purgeUrl = process.env.PURGE_URL ?? 'http://localhost:4003';

const app = Fastify({ logger: true });

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, { openapi: { info: { title: 'Endorse Service', version: '0.1.0' } } });
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

const appendEvent = async (
  type: string,
  payload: unknown,
  actorId: string,
  generation: GenerationCohort,
  correlationId?: string,
  idempotencyKey?: string,
) => {
  const evt = buildEvent(type, payload, {
    actorId,
    actorGeneration: generation,
    correlationId,
  });
  await persistEvent(pool, evt, { idempotencyKey, context: payload as Record<string, unknown> });
  const topic = 'events.endorse.v1';
  try {
    await publishEvent(topic, evt);
  } catch (err: any) {
    await recordOutbox(pool, topic, evt.event_id, evt);
  }
  return evt;
};

const getAuth = (request: any) => {
  const header = request.headers.authorization;
  if (!header) return null;
  return verifyAccess(header.replace('Bearer ', ''));
};

const getEntry = async (entryId: string) => {
  const res = await fetch(`${discourseUrl}/internal/entries/${entryId}`, {
    headers: { 'x-internal-call': 'true' },
  });
  if (!res.ok) return null;
  return (await res.json()).entry as { id: string; generation: GenerationCohort };
};

const getPurgeStatus = async () => {
  try {
    const res = await fetch(`${purgeUrl}/purge/status`);
    return (await res.json()) as { active: boolean };
  } catch {
    return { active: false };
  }
};

const spendCred = async (
  authHeader: string | undefined,
  userId: string,
  correlationId?: string,
  idempotencyKey?: string,
) => {
  const res = await fetch(`${credUrl}/cred/spend`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authHeader ? { authorization: authHeader } : {}),
      'x-correlation-id': correlationId ?? '',
      'x-idempotency-key': idempotencyKey ?? '',
    },
    body: JSON.stringify({ bucket: 'ENDORSE', reason_code: 'endorsement' }),
  });
  if (!res.ok) {
    throw new Error('cred spend failed');
  }
  return res.json();
};

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));
app.get('/metrics', async () => ({ status: 'ok' }));

app.post('/endorse', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation || !auth.verified) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: `endorse:${auth.sub}`, limit: 30, windowSec: 60 })(request, reply);
  const body = request.body as { entry_id: string; intent: EndorseIntent };
  if (!body.entry_id || !body.intent) {
    reply.status(400);
    return { error: 'entry_id and intent required' };
  }
  if (!Object.values(EndorseIntent).includes(body.intent)) {
    reply.status(400);
    return { error: 'invalid intent' };
  }
  const entry = await getEntry(body.entry_id);
  if (!entry && !purge.active) {
    reply.status(404);
    return { error: 'entry not found' };
  }
  const purge = await getPurgeStatus();
  if (!purge.active && entry && entry.generation !== auth.generation) {
    reply.status(403);
    return { error: 'cross-gen endorsements blocked' };
  }
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const result = await withIdempotency(pool, idempotencyKey, async () => {
    await spendCred(request.headers.authorization as string | undefined, auth.sub, correlationId, idempotencyKey);
    const endRes = await pool.query(
      'insert into endorsements (entry_id, user_id, user_generation, intent) values ($1,$2,$3,$4) returning *',
      [body.entry_id, auth.sub, auth.generation, body.intent],
    );
    const evt = await appendEvent(
      'endorse.created',
      {
        endorsement_id: endRes.rows[0].id,
        entry_id: body.entry_id,
        intent: body.intent,
        cross_gen: entry.generation !== auth.generation,
      },
      auth.sub,
      auth.generation,
      correlationId,
      idempotencyKey,
    );
    return { endorsement: endRes.rows[0], event_id: evt.event_id };
  });
  return result;
});

app.get('/endorsements', async (request) => {
  const entryId = (request.query as any).entry_id;
  const res = entryId
    ? await pool.query('select * from endorsements where entry_id=$1 order by created_at desc', [
        entryId,
      ])
    : await pool.query('select * from endorsements order by created_at desc limit 100');
  return { endorsements: res.rows };
});

app.get('/events', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const limit = Number((request.query as any).limit ?? 50);
  const rows = await pool.query('select * from events order by occurred_at desc limit $1', [limit]);
  return { events: rows.rows };
});

app.get('/admin/outbox', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const rows = await pool.query('select * from outbox');
  return { outbox: rows.rows };
});

setInterval(() => {
  dispatchOutbox(pool, async (topic, payload) => publishEvent(topic, payload));
}, 10000);

const start = async () => {
  const port = Number(process.env.PORT ?? 4005);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`endorse running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start endorse');
  process.exit(1);
});

