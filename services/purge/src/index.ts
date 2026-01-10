import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ensureCorrelationId, getPool, withIdempotency } from '@platform/shared';
import { Role } from '@platform/security';
import { buildEvent, persistEvent, publishEvent } from '@platform/events';
import { recordOutbox, dispatchOutbox } from '@platform/shared';

const pool = getPool('purge');

const app = Fastify({ logger: true });

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, { openapi: { info: { title: 'Purge Service', version: '0.1.0' } } });
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

const appendEvent = async (type: string, payload: unknown, correlationId?: string) => {
  const evt = buildEvent(type, payload, { actorId: '00000000-0000-0000-0000-000000000000', correlationId });
  await persistEvent(pool, evt, { context: payload as Record<string, unknown> });
  const topic = 'events.purge.v1';
  try {
    await publishEvent(topic, evt);
  } catch (err: any) {
    await recordOutbox(pool, topic, evt.event_id, evt);
  }
  return evt;
};

const getCurrent = async () => {
  const now = new Date();
  const active = await pool.query(
    'select * from purge_windows where starts_at <= $1 and ends_at >= $1 order by starts_at desc limit 1',
    [now],
  );
  if ((active.rowCount ?? 0) > 0) {
    return { status: 'active', window: active.rows[0] };
  }
  const upcoming = await pool.query(
    'select * from purge_windows where starts_at > $1 order by starts_at asc limit 1',
    [now],
  );
  if ((upcoming.rowCount ?? 0) > 0) {
    return { status: 'scheduled', window: upcoming.rows[0] };
  }
  return { status: 'idle', window: null };
};

const getLastWindow = async () => {
  const last = await pool.query('select * from purge_windows order by starts_at desc limit 1');
  return (last.rowCount ?? 0) > 0 ? last.rows[0] : null;
};

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));
app.get('/metrics', async () => ({ status: 'ok' }));

app.get('/purge/status', async () => {
  const current = await getCurrent();
  const last = await getLastWindow();
  return {
    active: current.status === 'active',
    status: current.status,
    starts_at: current.window?.starts_at ?? null,
    ends_at: current.window?.ends_at ?? null,
    last_starts_at: last?.starts_at ?? null,
    last_ends_at: last?.ends_at ?? null,
  };
});

app.post('/purge/schedule', async (request, reply) => {
  const role = request.headers['x-ops-role'] as string | undefined;
  const allowed = role && role === Role.CoreOps;
  if (!allowed) {
    reply.status(403);
    return { error: 'forbidden' };
  }
  const body = request.body as { starts_at: string };
  if (!body.starts_at) {
    reply.status(400);
    return { error: 'starts_at required' };
  }
  const startsAt = new Date(body.starts_at);
  const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const result = await withIdempotency(pool, idempotencyKey, async () => {
    const existing = await pool.query(
      'select * from purge_windows where tstzrange(starts_at, ends_at, \'[]\') && tstzrange($1,$2,\'[]\') limit 1',
      [startsAt, endsAt],
    );
    const win =
      (existing.rowCount ?? 0) > 0
        ? existing
        : await pool.query(
            'insert into purge_windows (starts_at, ends_at, created_by, status) values ($1,$2,$3,$4) returning *',
            [startsAt, endsAt, 'ops', 'scheduled'],
          );
    const evt = await appendEvent(
      'purge.window_scheduled',
      { window_id: win.rows[0].id, starts_at: startsAt, ends_at: endsAt },
      correlationId,
    );
    return { scheduled: true, window: win.rows[0], event_id: evt.event_id };
  });
  return result;
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

app.get('/purge/surge-recommendations', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const rows = await pool.query('select * from purge_surge_recommendations order by created_at desc limit 20');
  return { recommendations: rows.rows };
});

setInterval(() => {
  dispatchOutbox(pool, async (topic, payload) => publishEvent(topic, payload));
}, 10000);

app.post('/purge/reset', async (request, reply) => {
  const role = request.headers['x-ops-role'] as string | undefined;
  if (!role) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  await pool.query('delete from purge_windows');
  await appendEvent('purge.reset', { reset: true }, request.headers['x-correlation-id'] as string | undefined);
  return { reset: true };
});

// Dev-only: force a short Gathering window (ops role required).
app.post('/purge/admin/start', async (request, reply) => {
  const role = request.headers['x-ops-role'] as string | undefined;
  if (!role) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const body = (request.body ?? {}) as { minutes?: number };
  const minutes = Math.max(1, Math.min(180, Number(body.minutes ?? 45)));
  const startsAt = new Date();
  const endsAt = new Date(Date.now() + minutes * 60_000);
  await pool.query('insert into purge_windows (starts_at, ends_at) values ($1, $2)', [startsAt, endsAt]);
  await appendEvent('purge.admin_start', { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), minutes }, request.headers['x-correlation-id'] as string | undefined);
  return { ok: true, active: true, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() };
});

// Dev-only: schedule a Gathering window a few seconds/minutes into the future (for countdown testing).
// Accepts dev ops role (same as /purge/admin/start).
app.post('/purge/admin/schedule', async (request, reply) => {
  const role = request.headers['x-ops-role'] as string | undefined;
  if (!role) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const body = (request.body ?? {}) as { minutes?: number; starts_in_seconds?: number };
  const minutes = Math.max(1, Math.min(180, Number(body.minutes ?? 5)));
  const startsIn = Math.max(0, Math.min(3600, Number(body.starts_in_seconds ?? 10)));
  const startsAt = new Date(Date.now() + startsIn * 1000);
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
  await pool.query('insert into purge_windows (starts_at, ends_at, status) values ($1, $2, $3)', [startsAt, endsAt, 'scheduled']);
  await appendEvent(
    'purge.admin_scheduled',
    { starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), minutes, starts_in_seconds: startsIn },
    request.headers['x-correlation-id'] as string | undefined,
  );
  return { ok: true, active: false, status: 'scheduled', starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() };
});

const start = async () => {
  const port = Number(process.env.PORT ?? 4003);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`purge running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start purge');
  process.exit(1);
});

