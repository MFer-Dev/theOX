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
import { buildEvent, persistEvent, publishEvent } from '@platform/events';

const app = Fastify({ logger: true });
const pool = getPool('notes');
const ALGO_VERSION = 'v1';

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, { openapi: { info: { title: 'Notes Service', version: '0.0.1' } } });
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

const appendEvent = async (type: string, payload: unknown, correlationId?: string, idempotencyKey?: string) => {
  const evt = buildEvent(type, payload, { actorId: 'notes', correlationId });
  await persistEvent(pool, evt, { idempotencyKey, context: payload as Record<string, unknown> });
  const topic = 'events.notes.v1';
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

const rlKey = (request: any, auth: any, action: string) => {
  const device =
    (request.headers['x-device-id'] as string | undefined) ??
    (request.headers['x-device-fingerprint'] as string | undefined) ??
    'unknown';
  const ip = (request.ip as string | undefined) ?? (request.headers['x-forwarded-for'] as string | undefined) ?? 'unknown';
  return `notes:${action}:${auth?.sub ?? 'anon'}:${device}:${ip}`;
};

const crossGenThresholdMet = async (noteId: string, minGenerations = 2) => {
  const res = await pool.query('select distinct generation from note_participants where note_id=$1', [noteId]);
  return res.rows.filter((r) => r.generation).length >= minGenerations;
};

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));
app.get('/metrics', async () => ({ status: 'ok' }));

app.post('/notes', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: rlKey(request, auth, 'create'), limit: 20, windowSec: 60, cooldownSec: 300, cooldownThreshold: 40 })(request, reply);
  if ((reply as any).sent) return reply;
  const body = request.body as { content_id: string; body: string; citations?: any[] };
  if (!body?.content_id || !body?.body) {
    reply.status(400);
    return { error: 'content_id and body required' };
  }
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const noteId = await withIdempotency(pool, idempotencyKey, async () => {
    const noteRes = await pool.query(
      `insert into notes (content_id, status, algo_version, created_by, created_by_generation)
       values ($1,$2,$3,$4,$5) returning id`,
      [body.content_id, 'draft', ALGO_VERSION, auth.sub, auth.generation ?? null],
    );
    const nid = noteRes.rows[0].id;
    await pool.query(
      `insert into note_versions (note_id, version, body, status, algo_version, created_by, created_by_generation)
       values ($1,1,$2,'draft',$3,$4,$5)`,
      [nid, body.body, ALGO_VERSION, auth.sub, auth.generation ?? null],
    );
    await pool.query(
      `insert into note_participants (note_id, user_id, generation, role) values ($1,$2,$3,$4)
       on conflict do nothing`,
      [nid, auth.sub, auth.generation ?? null, 'author'],
    );
    if (body.citations && Array.isArray(body.citations)) {
      for (const c of body.citations) {
        await pool.query(
          `insert into note_citations (note_id, citation_type, source, url, hash, created_by, created_by_generation)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [nid, c.type ?? 'secondary', c.source ?? null, c.url ?? null, c.hash ?? null, auth.sub, auth.generation ?? null],
        );
      }
    }
    await appendEvent('note.created', { note_id: nid, content_id: body.content_id }, correlationId, idempotencyKey);
    await pool.query('insert into note_audit (note_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5)', [
      nid,
      'created',
      auth.sub,
      auth.generation ?? null,
      { body: 'created draft' },
    ]);
    return nid;
  });
  return { note_id: noteId, status: 'draft' };
});

app.post('/notes/:id/update', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: rlKey(request, auth, 'update'), limit: 60, windowSec: 60, cooldownSec: 300, cooldownThreshold: 90 })(request, reply);
  if ((reply as any).sent) return reply;
  const noteId = (request.params as any)['id'];
  const body = request.body as { body: string; status?: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const status = body.status ?? 'visible';
  const versionRes = await pool.query('select coalesce(max(version),0)+1 as v from note_versions where note_id=$1', [noteId]);
  const version = versionRes.rows[0].v;
  await withIdempotency(pool, idempotencyKey, async () => {
    await pool.query(
      `insert into note_versions (note_id, version, body, status, algo_version, created_by, created_by_generation)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [noteId, version, body.body, status, ALGO_VERSION, auth.sub, auth.generation ?? null],
    );
    await pool.query('update notes set status=$2, algo_version=$3, computed_at=now() where id=$1', [
      noteId,
      status,
      ALGO_VERSION,
    ]);
    await pool.query(
      `insert into note_participants (note_id, user_id, generation, role) values ($1,$2,$3,$4)
       on conflict do nothing`,
      [noteId, auth.sub, auth.generation ?? null, 'editor'],
    );
    await appendEvent('note.updated', { note_id: noteId, version, status }, correlationId, idempotencyKey);
    await pool.query(
      'insert into note_audit (note_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5)',
      [noteId, 'updated', auth.sub, auth.generation ?? null, { status, version }],
    );
  });
  return { note_id: noteId, version, status };
});

app.post('/notes/:id/cite', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: rlKey(request, auth, 'cite'), limit: 120, windowSec: 60 })(request, reply);
  if ((reply as any).sent) return reply;
  const noteId = (request.params as any)['id'];
  const c = request.body as { type: string; source?: string; url?: string; hash?: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  await withIdempotency(pool, idempotencyKey, async () => {
    await pool.query(
      `insert into note_citations (note_id, citation_type, source, url, hash, created_by, created_by_generation)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [noteId, c.type ?? 'secondary', c.source ?? null, c.url ?? null, c.hash ?? null, auth.sub, auth.generation ?? null],
    );
    await appendEvent('note.cited', { note_id: noteId, citation_type: c.type ?? 'secondary' }, correlationId, idempotencyKey);
    await pool.query(
      'insert into note_audit (note_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5)',
      [noteId, 'cited', auth.sub, auth.generation ?? null, { type: c.type, url: c.url }],
    );
  });
  return { note_id: noteId, cited: true };
});

app.post('/notes/:id/feature', async (request, reply) => {
  const role = request.headers['x-ops-role'];
  const noteId = (request.params as any)['id'];
  if (!role) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const thresholdOk = await crossGenThresholdMet(noteId, 2);
  if (!thresholdOk) {
    reply.status(400);
    return { error: 'Cross-gen threshold not met' };
  }
  await withIdempotency(pool, idempotencyKey, async () => {
    await pool.query('update notes set status=$2, computed_at=now() where id=$1', [noteId, 'featured']);
    await appendEvent('note.featured', { note_id: noteId }, correlationId, idempotencyKey);
    await pool.query('insert into note_audit (note_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5)', [
      noteId,
      'featured',
      null,
      null,
      { by_role: role },
    ]);
  });
  return { note_id: noteId, status: 'featured' };
});

app.post('/notes/:id/deprecate', async (request, reply) => {
  const role = request.headers['x-ops-role'];
  const noteId = (request.params as any)['id'];
  if (!role) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  await withIdempotency(pool, idempotencyKey, async () => {
    await pool.query('update notes set status=$2, computed_at=now() where id=$1', [noteId, 'deprecated']);
    await appendEvent('note.deprecated', { note_id: noteId }, correlationId, idempotencyKey);
    await pool.query('insert into note_audit (note_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5)', [
      noteId,
      'deprecated',
      null,
      null,
      { by_role: role },
    ]);
  });
  return { note_id: noteId, status: 'deprecated' };
});

app.get('/notes', async (request) => {
  const limit = Number((request.query as any).limit ?? 50);
  const res = await pool.query('select * from notes order by created_at desc limit $1', [limit]);
  return { notes: res.rows };
});

app.get('/notes/:id', async (request) => {
  const noteId = (request.params as any)['id'];
  const note = await pool.query('select * from notes where id=$1', [noteId]);
  const versions = await pool.query('select * from note_versions where note_id=$1 order by version desc', [noteId]);
  const citations = await pool.query('select * from note_citations where note_id=$1', [noteId]);
  const participants = await pool.query('select * from note_participants where note_id=$1', [noteId]);
  const audit = await pool.query('select * from note_audit where note_id=$1 order by created_at desc', [noteId]);
  return {
    note: note.rows[0] ?? null,
    versions: versions.rows,
    citations: citations.rows,
    participants: participants.rows,
    audit: audit.rows,
  };
});

app.get('/notes/by-content/:id', async (request) => {
  const contentId = (request.params as any)['id'];
  const notes = await pool.query(
    `
    select n.*, nv.body as latest_body, nv.version as latest_version
    from notes n
    left join lateral (
      select body, version from note_versions nv where nv.note_id = n.id order by version desc limit 1
    ) nv on true
    where n.content_id = $1
    order by n.created_at desc
    `,
    [contentId],
  );
  const noteIds = notes.rows.map((r) => r.id);
  let citations: any[] = [];
  let versions: any[] = [];
  const eligibility: Record<string, boolean> = {};
  if (noteIds.length > 0) {
    const c = await pool.query('select * from note_citations where note_id = any($1)', [noteIds]);
    const v = await pool.query(
      'select * from note_versions where note_id = any($1) order by note_id asc, version desc',
      [noteIds],
    );
    citations = c.rows;
    versions = v.rows;
    for (const id of noteIds) {
      eligibility[id] = await crossGenThresholdMet(id, 2);
    }
  }
  const notesWithEligibility = notes.rows.map((n) => ({
    ...n,
    eligible: eligibility[n.id] ?? false,
  }));
  return { notes: notesWithEligibility, citations, versions };
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
  const port = Number(process.env.PORT ?? 4006);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`notes running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start notes');
  process.exit(1);
});

