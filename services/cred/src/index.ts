import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  ensureCorrelationId,
  getPool,
  withIdempotency,
  verifyAccess,
  GenerationCohort,
  recordOutbox,
  dispatchOutbox,
} from '@platform/shared';
import { buildEvent, persistEvent, publishEvent } from '@platform/events';

const pool = getPool('cred');

const app = Fastify({ logger: true });

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, { openapi: { info: { title: 'Cred Service', version: '0.1.0' } } });
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });
app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));
app.get('/metrics', async () => ({ status: 'ok' }));

const appendEvent = async (
  eventType: string,
  payload: unknown,
  actorId?: string,
  actorGeneration?: GenerationCohort | null,
  correlationId?: string,
  idempotencyKey?: string,
) => {
  const evt = buildEvent(eventType, payload, {
    actorId: actorId ?? 'system',
    actorGeneration: actorGeneration ?? undefined,
    correlationId,
  });
  await persistEvent(pool, evt, { idempotencyKey, context: payload as Record<string, unknown> });
  const topic = 'events.cred.v1';
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

const ensureBalance = async (userId: string) => {
  const existing = await pool.query('select * from cred_balances where user_id=$1', [userId]);
  if (existing.rowCount === 0) {
    await pool.query(
      'insert into cred_balances (user_id, claims_remaining, replies_remaining, endorses_remaining, notes_remaining) values ($1,5,10,5,3)',
      [userId],
    );
  }
};

app.post('/internal/init-balance', async (request, reply) => {
  const userId = (request.body as any)?.user_id;
  if (!userId) {
    reply.status(400);
    return { error: 'user_id required' };
  }
  await ensureBalance(userId);
  return { ok: true };
});

app.get('/cred/balances', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await ensureBalance(auth.sub);
  const res = await pool.query('select * from cred_balances where user_id=$1', [auth.sub]);
  return { balance: res.rows[0] };
});

type Bucket = 'CLAIM' | 'REPLY' | 'ENDORSE' | 'NOTE';
const bucketColumn: Record<Bucket, string> = {
  CLAIM: 'claims_remaining',
  REPLY: 'replies_remaining',
  ENDORSE: 'endorses_remaining',
  NOTE: 'notes_remaining',
};

app.post('/cred/spend', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const body = request.body as { bucket: Bucket; reason_code: string };
  if (!body.bucket || !body.reason_code) {
    reply.status(400);
    return { error: 'bucket and reason_code required' };
  }
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const result = await withIdempotency(pool, idempotencyKey, async () => {
    await ensureBalance(auth.sub);
    const column = bucketColumn[body.bucket];
    const balRes = await pool.query(
      `select ${column} as remaining from cred_balances where user_id=$1 for update`,
      [auth.sub],
    );
    const remaining = balRes.rows[0]?.remaining ?? 0;
    if (remaining < 1) {
      reply.status(402);
      return { error: 'insufficient cred' } as any;
    }
    await pool.query(`update cred_balances set ${column} = ${column} - 1, updated_at=now() where user_id=$1`, [
      auth.sub,
    ]);
    const ledgerRes = await pool.query(
      `insert into cred_ledger (user_id, delta_claims, delta_replies, delta_endorses, delta_notes, reason_code, correlation_id)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        auth.sub,
        body.bucket === 'CLAIM' ? -1 : 0,
        body.bucket === 'REPLY' ? -1 : 0,
        body.bucket === 'ENDORSE' ? -1 : 0,
        body.bucket === 'NOTE' ? -1 : 0,
        body.reason_code,
        correlationId,
      ],
    );
    const evt = await appendEvent(
      'cred.spent',
      { user_id: auth.sub, bucket: body.bucket, reason_code: body.reason_code, ledger_id: ledgerRes.rows[0].id },
      auth.sub,
      auth.generation,
      correlationId,
      idempotencyKey,
    );
    return { spent: true, ledger_id: ledgerRes.rows[0].id, event_id: evt.event_id };
  });
  return result;
});

app.post('/cred/earn', async (request, reply) => {
  const role = request.headers['x-ops-role'];
  if (!role) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const body = request.body as { user_id: string; delta_claims?: number; delta_replies?: number; delta_endorses?: number; delta_notes?: number; reason_code: string };
  if (!body.user_id || !body.reason_code) {
    reply.status(400);
    return { error: 'user_id and reason_code required' };
  }
  await ensureBalance(body.user_id);
  const deltaClaims = body.delta_claims ?? 0;
  const deltaReplies = body.delta_replies ?? 0;
  const deltaEndorse = body.delta_endorses ?? 0;
  const deltaNotes = body.delta_notes ?? 0;
  await pool.query(
    `update cred_balances set 
      claims_remaining = claims_remaining + $2,
      replies_remaining = replies_remaining + $3,
      endorses_remaining = endorses_remaining + $4,
      notes_remaining = notes_remaining + $5,
      updated_at = now()
     where user_id=$1`,
    [body.user_id, deltaClaims, deltaReplies, deltaEndorse, deltaNotes],
  );
  const ledgerRes = await pool.query(
    `insert into cred_ledger (user_id, delta_claims, delta_replies, delta_endorses, delta_notes, reason_code, correlation_id)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [body.user_id, deltaClaims, deltaReplies, deltaEndorse, deltaNotes, body.reason_code, request.headers['x-correlation-id'] as string | undefined],
  );
  const evt = await appendEvent(
    'cred.earned',
    {
      user_id: body.user_id,
      delta_claims: deltaClaims,
      delta_replies: deltaReplies,
      delta_endorses: deltaEndorse,
      delta_notes: deltaNotes,
      reason_code: body.reason_code,
      ledger_id: ledgerRes.rows[0].id,
    },
    body.user_id,
    null,
    request.headers['x-correlation-id'] as string | undefined,
  );
  return { earned: true, event_id: evt.event_id };
});

app.get('/cred/ledger', async (request, reply) => {
  const auth = getAuth(request);
  const userId = (request.query as any).user_id ?? auth?.sub;
  if (!userId) {
    reply.status(400);
    return { error: 'user_id required' };
  }
  if (!auth && !request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const res = await pool.query('select * from cred_ledger where user_id=$1 order by created_at desc limit 100', [
    userId,
  ]);
  return { ledger: res.rows };
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
  const port = Number(process.env.PORT ?? 4004);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`cred running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start cred');
  process.exit(1);
});

