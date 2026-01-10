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
  rateLimitMiddleware,
} from '@platform/shared';
import { isAllowed, Role } from '@platform/security';
import { buildEvent, persistEvent, publishEvent, runConsumer, EventEnvelope, ConsumerMeta } from '@platform/events';

const pool = getPool('safety');
const app = Fastify({ logger: true });
const ALGO_VERSION = 'v1';
let purgeActive = false;

// Simple in-memory detection state (process-local)
const burstWindowMs = 5 * 60 * 1000;
type WindowBucket = { ts: number; count: number };
const endorseBursts: Record<string, WindowBucket[]> = {};
const replyBursts: Record<string, WindowBucket[]> = {};
const credBursts: Record<string, WindowBucket[]> = {};

const now = () => Date.now();

const rollWindow = (buckets: WindowBucket[]) => {
  const cutoff = now() - burstWindowMs;
  while (buckets.length && buckets[0].ts < cutoff) buckets.shift();
  return buckets;
};

const recordBucket = (map: Record<string, WindowBucket[]>, key: string) => {
  const buckets = map[key] ?? [];
  rollWindow(buckets);
  const current = buckets[buckets.length - 1];
  if (current && now() - current.ts < 60 * 1000) {
    current.count += 1;
  } else {
    buckets.push({ ts: now(), count: 1 });
  }
  map[key] = buckets;
  return buckets.reduce((sum, b) => sum + b.count, 0);
};

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, { openapi: { info: { title: 'Safety Service', version: '0.1.0' } } });
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

const appendEvent = async (
  type: string,
  payload: unknown,
  actorId?: string,
  correlationId?: string,
  idempotencyKey?: string,
) => {
  const evt = buildEvent(type, payload, { actorId: actorId ?? 'system', correlationId });
  await persistEvent(pool, evt, { idempotencyKey, context: payload as Record<string, unknown> });
  const topic = 'events.safety.v1';
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

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));
app.get('/metrics', async () => ({ status: 'ok' }));

const appendSafetyEvent = async (
  type: string,
  payload: unknown,
  correlationId?: string,
  idempotencyKey?: string,
) => {
  const evt = buildEvent(type, payload, { actorId: undefined as any, correlationId });
  await persistEvent(pool, evt, { idempotencyKey, context: payload as Record<string, unknown> });
  const topic = 'events.safety.v1';
  try {
    await publishEvent(topic, evt);
  } catch (err: any) {
    await recordOutbox(pool, topic, evt.event_id, evt);
  }
  return evt;
};

const applyFriction = async (args: {
  target_type: string;
  target_id: string;
  friction_type: string;
  expires_in_sec?: number;
  correlationId?: string;
  idempotencyKey?: string;
  reason?: string;
}) => {
  const expires = new Date(Date.now() + (args.expires_in_sec ?? 1800) * 1000);
  const fr = await withIdempotency(pool, args.idempotencyKey, async () => {
    const row = await pool.query(
      `insert into safety_friction (target_type, target_id, friction_type, expires_at, algo_version, inputs_window, computed_at)
       values ($1,$2,$3,$4,$5,$6,now()) returning *`,
      [args.target_type, args.target_id, args.friction_type, expires.toISOString(), ALGO_VERSION, 'event'],
    );
    await appendSafetyEvent(
      'safety.friction.applied',
      {
        friction_id: row.rows[0].id,
        target_type: args.target_type,
        target_id: args.target_id,
        friction_type: args.friction_type,
        expires_at: expires.toISOString(),
        reason: args.reason,
      },
      args.correlationId,
      args.idempotencyKey,
    );
    await pool.query(
      'insert into safety_audit (target_type, target_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5,$6)',
      [
        args.target_type,
        args.target_id,
        'friction_applied',
        null,
        null,
        { friction_type: args.friction_type, expires_at: expires.toISOString(), reason: args.reason },
      ],
    );
    return row.rows[0];
  });
  return fr;
};

app.post('/reports', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: `reports:${auth.sub}`, limit: 10, windowSec: 60, cooldownSec: 300, cooldownThreshold: 12 })(request, reply);
  const body = request.body as { target_type: string; target_id: string; reason: string };
  if (!body.target_type || !body.target_id || !body.reason) {
    reply.status(400);
    return { error: 'target_type, target_id, reason required' };
  }
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const result = await withIdempotency(pool, idempotencyKey, async () => {
    const rep = await pool.query(
      'insert into reports (reporter_id, target_type, target_id, reason) values ($1,$2,$3,$4) returning *',
      [auth.sub, body.target_type, body.target_id, body.reason],
    );
    const evt = await appendEvent(
      'safety.report_created',
      { report_id: rep.rows[0].id, target_type: body.target_type, target_id: body.target_id },
      auth.sub,
      correlationId,
      idempotencyKey,
    );
    return { report: rep.rows[0], event_id: evt.event_id };
  });
  return result;
});

app.get('/moderation/queue', async (request, reply) => {
  const role = request.headers['x-ops-role'];
  if (!role) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const res = await pool.query('select * from reports where status=$1 order by created_at asc', [
    'open',
  ]);
  return { queue: res.rows };
});

app.get('/reports/:id', async (request, reply) => {
  const role = request.headers['x-ops-role'];
  if (!role) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const res = await pool.query('select * from reports where id=$1', [(request.params as any)['id']]);
  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'not found' };
  }
  return { report: res.rows[0] };
});

app.post('/moderation/action', async (request, reply) => {
  const role = request.headers['x-ops-role'] as Role | undefined;
  const allowed = role && isAllowed({
    actorId: 'ops',
    actorGeneration: 'millennial',
    correlationId: request.headers['x-correlation-id'] as string,
    purgeContext: 'inactive',
    role: role as Role,
    resource: 'moderation_action',
    action: 'write',
  });
  if (!allowed) {
    reply.status(403);
    return { error: 'forbidden' };
  }
  const body = request.body as { target_type: string; target_id: string; action: string; reason_code: string };
  if (!body.target_type || !body.target_id || !body.action || !body.reason_code) {
    reply.status(400);
    return { error: 'missing fields' };
  }
  const res = await pool.query(
    'insert into moderation_actions (actor_ops_id, target_type, target_id, action, reason_code) values ($1,$2,$3,$4,$5) returning *',
    ['ops', body.target_type, body.target_id, body.action, body.reason_code],
  );
  const evt = await appendEvent(
    'safety.moderation_action',
    { moderation_id: res.rows[0].id, target_type: body.target_type, action: body.action },
    'ops',
    request.headers['x-correlation-id'] as string | undefined,
  );
  return { action: res.rows[0], event_id: evt.event_id };
});

app.post('/appeals', async () => ({ appeal: 'received' }));
app.get('/appeals/queue', async () => ({ queue: [] }));

app.post('/safety/flag', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const body = request.body as { content_id: string; reason: string };
  if (!body?.content_id || !body?.reason) {
    reply.status(400);
    return { error: 'content_id and reason required' };
  }
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const res = await withIdempotency(pool, idempotencyKey, async () => {
    const flag = await pool.query(
      'insert into safety_flags (target_type, target_id, reason, algo_version, created_by, created_by_generation) values ($1,$2,$3,$4,$5,$6) returning *',
      ['content', body.content_id, body.reason, ALGO_VERSION, auth.sub, auth.generation ?? null],
    );
    await appendSafetyEvent(
      'safety.flag.raised',
      { flag_id: flag.rows[0].id, target_type: 'content', target_id: body.content_id, reason: body.reason },
      correlationId,
      idempotencyKey,
    );
    await pool.query(
      'insert into safety_audit (target_type, target_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5,$6)',
      ['content', body.content_id, 'flag_raised', auth.sub, auth.generation ?? null, { reason: body.reason }],
    );
    return flag.rows[0];
  });
  return { flag: res };
});

app.post('/safety/friction', async (request, reply) => {
  const role = request.headers['x-ops-role'];
  if (!role) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const body = request.body as { target_type: string; target_id: string; friction_type: string; expires_in_sec?: number };
  if (!body?.target_type || !body?.target_id || !body?.friction_type) {
    reply.status(400);
    return { error: 'target_type, target_id, friction_type required' };
  }
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const fr = await withIdempotency(pool, idempotencyKey, async () => {
    return applyFriction({
      target_type: body.target_type,
      target_id: body.target_id,
      friction_type: body.friction_type,
      expires_in_sec: body.expires_in_sec,
      correlationId,
      idempotencyKey,
    });
  });
  return { friction: fr };
});

app.get('/safety/friction', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const rows = await pool.query('select * from safety_friction where expires_at > now() order by expires_at asc');
  return { friction: rows.rows };
});

app.get('/safety/my-status', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const restrictions = await pool.query('select * from safety_restrictions where user_id=$1 and expires_at > now()', [auth.sub]);
  const frictions = await pool.query('select * from safety_friction where target_id=$1 and expires_at > now()', [auth.sub]);
  return { restrictions: restrictions.rows, frictions: frictions.rows };
});

app.post('/safety/appeal/submit', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const body = request.body as { flag_id?: string; friction_id?: string; message: string };
  if (!body?.message) {
    reply.status(400);
    return { error: 'message required' };
  }
  const hasFlag = Boolean(body.flag_id);
  const hasFriction = Boolean(body.friction_id);
  if ((hasFlag && hasFriction) || (!hasFlag && !hasFriction)) {
    reply.status(400);
    return { error: 'exactly one of flag_id or friction_id required' };
  }
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const row = await withIdempotency(pool, idempotencyKey, async () => {
    // Resolve the appealed target (content/user/entry) from the supplied flag/friction id.
    let target_type: string | null = null;
    let target_id: string | null = null;
    let reason: string | null = null;
    if (body.flag_id) {
      const flag = await pool.query('select target_type, target_id, reason from safety_flags where id=$1', [body.flag_id]);
      if (!flag.rowCount) {
        reply.status(404);
        return { error: 'flag_not_found' } as any;
      }
      target_type = String(flag.rows[0].target_type);
      target_id = String(flag.rows[0].target_id);
      reason = String(flag.rows[0].reason ?? 'flag');
    }
    if (body.friction_id) {
      const fr = await pool.query('select target_type, target_id, friction_type from safety_friction where id=$1', [body.friction_id]);
      if (!fr.rowCount) {
        reply.status(404);
        return { error: 'friction_not_found' } as any;
      }
      target_type = String(fr.rows[0].target_type);
      target_id = String(fr.rows[0].target_id);
      reason = `friction:${String(fr.rows[0].friction_type ?? 'unknown')}`;
    }
    if (!target_type || !target_id) {
      reply.status(400);
      return { error: 'invalid_target' } as any;
    }
    const appeal = await pool.query(
      `insert into safety_appeals (flag_id, friction_id, target_type, target_id, reason, message, algo_version, created_by, created_by_generation)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [
        body.flag_id ?? null,
        body.friction_id ?? null,
        target_type,
        target_id,
        reason ?? 'appeal',
        String(body.message ?? '').slice(0, 2000),
        ALGO_VERSION,
        auth.sub,
        auth.generation ?? null,
      ],
    );
    await appendSafetyEvent(
      'safety.appeal.submitted',
      {
        appeal_id: appeal.rows[0].id,
        flag_id: body.flag_id ?? null,
        friction_id: body.friction_id ?? null,
        target_type,
        target_id,
      },
      correlationId,
      idempotencyKey,
    );
    await pool.query(
      'insert into safety_audit (target_type, target_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5,$6)',
      [
        'appeal',
        appeal.rows[0].id,
        'appeal_submitted',
        auth.sub,
        auth.generation ?? null,
        { message: body.message, flag_id: body.flag_id ?? null, friction_id: body.friction_id ?? null, target_type, target_id },
      ],
    );
    return appeal.rows[0];
  });
  return { appeal: row };
});

app.get('/safety/appeal/:id', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const appealId = (request.params as any)['id'];
  const rows = await pool.query('select * from safety_appeals where id=$1', [appealId]);
  if (rows.rowCount === 0) {
    reply.status(404);
    return { error: 'not found' };
  }
  // Only the author (or ops) can view appeal details.
  const appeal = rows.rows[0];
  const isOwner = String(appeal.created_by ?? '') === String(auth.sub ?? '');
  const isOps = Boolean(request.headers['x-ops-role']);
  if (!isOwner && !isOps) {
    reply.status(403);
    return { error: 'forbidden' };
  }
  const history = await pool.query(
    'select * from safety_audit where target_type=$1 and target_id=$2 order by created_at asc',
    ['appeal', appealId],
  );
  return { appeal, history: history.rows };
});

app.get('/safety/appeals', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const rows = await pool.query('select * from safety_appeals order by created_at desc limit 100');
  return { appeals: rows.rows };
});

app.post('/safety/appeals/:id/resolve', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const appealId = (request.params as any)['id'];
  const body = request.body as { resolution: string; reason?: string };
  const reason = String(body.reason ?? '').slice(0, 280);
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const res = await withIdempotency(pool, idempotencyKey, async () => {
    const row = await pool.query(
      `update safety_appeals set status='resolved', resolution=$2, decided_at=now(), computed_at=now() where id=$1 returning *`,
      [appealId, body.resolution ?? 'resolved'],
    );
    if (!row.rowCount) {
      reply.status(404);
      return { error: 'not_found' } as any;
    }
    await appendSafetyEvent(
      'safety.resolved',
      { appeal_id: appealId, resolution: body.resolution ?? 'resolved' },
      correlationId,
      idempotencyKey,
    );
    await pool.query(
      'insert into safety_audit (target_type, target_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5,$6)',
      ['appeal', appealId, 'appeal_resolved', null, null, { resolution: body.resolution ?? 'resolved', reason: reason || null }],
    );
    return row.rows[0];
  });
  return { appeal: res };
});

// Detection consumer (brigading/dogpile heuristics)
const detectionThresholds = {
  endorseBurst: 10,
  replyBurst: 15,
  credBurst: 20,
};

const handleDetection = async (evt: EventEnvelope<any>, _meta?: ConsumerMeta) => {
  switch (evt.event_type) {
    case 'endorse.created':
    case 'events.endorse.v1': {
      const entryId = evt.payload?.entry_id;
      if (!entryId) return;
      const count = recordBucket(endorseBursts, entryId);
      if (!purgeActive && count >= detectionThresholds.endorseBurst) {
        await applyFriction({
          target_type: 'entry',
          target_id: entryId,
          friction_type: 'endorse_weight_reduction',
          expires_in_sec: 1800,
          reason: 'endorsement_burst',
        });
        await appendSafetyEvent('safety.flag.raised', { target_type: 'entry', target_id: entryId, reason: 'endorsement_burst' });
      }
      break;
    }
    case 'discourse.reply_created': {
      const entryId = evt.payload?.entry_id;
      if (!entryId) return;
      const count = recordBucket(replyBursts, entryId);
      if (!purgeActive && count >= detectionThresholds.replyBurst) {
        await applyFriction({
          target_type: 'entry',
          target_id: entryId,
          friction_type: 'reply_cooldown',
          expires_in_sec: 1800,
          reason: 'reply_burst',
        });
        await appendSafetyEvent('safety.flag.raised', { target_type: 'entry', target_id: entryId, reason: 'reply_burst' });
      }
      break;
    }
    case 'cred.spent': {
      const target = evt.payload?.target_id || evt.actor_id;
      if (!target) return;
      const count = recordBucket(credBursts, target);
      if (!purgeActive && count >= detectionThresholds.credBurst) {
        await applyFriction({
          target_type: 'user',
          target_id: target,
          friction_type: 'cred_spend_throttle',
          expires_in_sec: 1200,
          reason: 'cred_velocity',
        });
        await appendSafetyEvent('safety.flag.raised', { target_type: 'user', target_id: target, reason: 'cred_velocity' });
      }
      break;
    }
    case 'purge.started':
      purgeActive = true;
      break;
    case 'purge.ended':
      purgeActive = false;
      break;
    default:
      break;
  }
};

const expireFriction = async () => {
  const rows = await pool.query('select * from safety_friction where status=$1 and expires_at <= now()', ['active']);
  for (const fr of rows.rows) {
    await pool.query('update safety_friction set status=$2 where id=$1', [fr.id, 'expired']);
    await appendSafetyEvent('safety.resolved', { friction_id: fr.id, target_type: fr.target_type, target_id: fr.target_id });
    await pool.query(
      'insert into safety_audit (target_type, target_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5,$6)',
      [fr.target_type, fr.target_id, 'friction_expired', null, null, { friction_id: fr.id }],
    );
  }
};

const startDetectionConsumer = async () => {
  await runConsumer({
    groupId: 'safety-detector',
    topics: ['events.discourse.v1', 'events.endorse.v1', 'events.cred.v1', 'events.purge.v1'],
    handler: handleDetection,
  });
};

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

app.get('/moderation/triage-suggestions', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const rows = await pool.query('select * from triage_suggestions order by created_at desc limit 50');
  return { suggestions: rows.rows };
});

setInterval(() => {
  dispatchOutbox(pool, async (topic, payload) => publishEvent(topic, payload));
}, 10000);

const start = async () => {
  const port = Number(process.env.PORT ?? 4008);
  await app.ready();
  startDetectionConsumer().catch((err) => app.log.error(err, 'safety detector failed'));
  setInterval(expireFriction, 60 * 1000);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`safety running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start safety');
  process.exit(1);
});

