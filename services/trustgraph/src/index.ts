import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ensureCorrelationId, getPool, recordOutbox, dispatchOutbox } from '@platform/shared';
import { buildEvent, persistEvent, runConsumer, publishEvent, EventEnvelope, ConsumerMeta } from '@platform/events';

const app = Fastify({ logger: true });
const pool = getPool('trustgraph');
const ALGO_VERSION = 'v1';

const WEIGHTS = {
  entry: 0.2,
  reply: 0.1,
  endorsementSame: 1,
  endorsementCross: 0.6,
  endorsementPurgeCross: 1.2,
  credSpent: 0.05,
  credEarned: 0.1,
  safetyAction: -0.5,
  noteCreated: 0.05,
  noteFeatured: 0.4,
  noteDeprecated: -0.2,
};

let purgeActive = false;

const INSIGHTS_MIN_K = Number(process.env.INSIGHTS_MIN_K ?? 50);
const INSIGHTS_API_KEY = process.env.INSIGHTS_API_KEY ?? '';

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, { openapi: { info: { title: 'TrustGraph Service', version: '0.1.0' } } });
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

const appendEvent = async (type: string, payload: unknown, correlationId?: string) => {
  const evt = buildEvent(type, payload, { actorId: 'trustgraph', correlationId });
  await persistEvent(pool, evt, { context: payload as Record<string, unknown> });
  const topic = 'events.trustgraph.v1';
  try {
    await publishEvent(topic, evt);
  } catch (err: any) {
    await recordOutbox(pool, topic, evt.event_id, evt);
  }
  return evt;
};

const ensureNode = async (userId: string, generation: string) => {
  await pool.query(
    `insert into trust_nodes (user_id, generation, algo_version, inputs_window, computed_at) values ($1,$2,$3,'event',now())
     on conflict (user_id, generation) do nothing`,
    [userId, generation, ALGO_VERSION],
  );
};

const dayKey = (ts: string) => {
  const d = new Date(ts);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
};

const hourKey = (ts: string) => {
  const d = new Date(ts);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours())).toISOString();
};

const bumpTopicGen = async (
  occurredAt: string,
  topic: string | null | undefined,
  generation: string | null | undefined,
  field: 'posts' | 'replies' | 'endorsements',
) => {
  const t = String(topic ?? '').trim().toLowerCase();
  const g = String(generation ?? '').trim().toLowerCase();
  if (!t || !g) return;
  const day = dayKey(occurredAt);
  await pool.query(
    `insert into semantic_topic_generation_daily (day, topic, generation, ${field})
     values ($1,$2,$3,1)
     on conflict (day, topic, generation)
     do update set ${field} = semantic_topic_generation_daily.${field} + 1, updated_at=now()`,
    [day, t, g],
  );
};

const bumpVolatility = async (
  occurredAt: string,
  topic: string | null | undefined,
  fields: { posts?: number; replies?: number; endorsements?: number },
) => {
  const t = String(topic ?? '').trim().toLowerCase();
  if (!t) return;
  const day = dayKey(occurredAt);
  const p = fields.posts ?? 0;
  const r = fields.replies ?? 0;
  const e = fields.endorsements ?? 0;
  const vol = p * 0.4 + r * 0.45 + e * 0.55;
  await pool.query(
    `insert into semantic_topic_volatility_daily (day, topic, volatility, posts, replies, endorsements)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (day, topic)
     do update set
       posts = semantic_topic_volatility_daily.posts + $4,
       replies = semantic_topic_volatility_daily.replies + $5,
       endorsements = semantic_topic_volatility_daily.endorsements + $6,
       volatility = semantic_topic_volatility_daily.volatility + $3,
       updated_at=now()`,
    [day, t, vol, p, r, e],
  );
};

const bumpGatheringImpact = async (
  occurredAt: string,
  field: 'posts' | 'replies' | 'endorsements',
) => {
  const hour = hourKey(occurredAt);
  await pool.query(
    `insert into semantic_gathering_impact_hourly (hour, active, ${field})
     values ($1,$2,1)
     on conflict (hour)
     do update set
       active = excluded.active,
       ${field} = semantic_gathering_impact_hourly.${field} + 1,
       updated_at=now()`,
    [hour, purgeActive],
  );
};

const updateVolatility = async (userId: string, generation: string, newScore: number) => {
  const history = await pool.query(
    'select value from trust_history where user_id=$1 and generation=$2 and metric=$3 order by created_at desc limit 1',
    [userId, generation, 'credibility'],
  );
  const prev = history.rows[0]?.value ?? 0;
  const delta = Math.abs(newScore - Number(prev));
  await pool.query(
    'insert into trust_history (user_id, generation, metric, value, window_label, algo_version, computed_at) values ($1,$2,$3,$4,$5,$6,now())',
    [userId, generation, 'credibility', newScore, 'event', ALGO_VERSION],
  );
  await pool.query('update trust_nodes set volatility_index=$3, updated_at=now() where user_id=$1 and generation=$2', [
    userId,
    generation,
    delta,
  ]);
};

const applyDelta = async (
  userId: string,
  generation: string,
  delta: number,
  opts?: { crossGen?: boolean; purge?: boolean; endorse?: { crossGen: boolean } },
) => {
  await ensureNode(userId, generation);
  const nodeRes = await pool.query('select * from trust_nodes where user_id=$1 and generation=$2', [userId, generation]);
  const node = nodeRes.rows[0];
  const newScore = Number(node.credibility_score) + delta;
  let same = Number(node.same_gen_endorsements);
  let cross = Number(node.cross_gen_endorsements);
  let purgeCross = Number(node.purge_cross_gen_endorsements);
  if (opts?.endorse) {
    if (opts.endorse.crossGen) {
      if (opts?.purge) {
        purgeCross += 1;
      } else {
        cross += 1;
      }
    } else {
      same += 1;
    }
  }
  const totalEndorse = same + cross + purgeCross;
  const quality = totalEndorse === 0 ? 0 : same / totalEndorse;
  const crossDelta = opts?.endorse?.crossGen ? delta : 0;
  await pool.query(
    `update trust_nodes
     set credibility_score=$3,
         cross_gen_delta=cross_gen_delta + $4,
         same_gen_endorsements=$5,
         cross_gen_endorsements=$6,
         purge_cross_gen_endorsements=$7,
         endorsement_quality_ratio=$8,
         inputs_window='event',
         algo_version=$9,
         computed_at=now(),
         updated_at=now()
     where user_id=$1 and generation=$2`,
    [userId, generation, newScore, crossDelta, same, cross, purgeCross, quality, ALGO_VERSION],
  );
  await updateVolatility(userId, generation, newScore);
};

const topicMetrics: Record<string, { partition: number; offset: string; last_event_ts?: string }> = {};

const processEvent = async (evt: EventEnvelope<any>, meta?: ConsumerMeta) => {
  const exists = await pool.query('select 1 from trust_processed_events where event_id=$1', [evt.event_id]);
  if ((exists.rowCount ?? 0) > 0) return;
  await pool.query(
    'insert into trust_events (event_id, event_type, actor_id, actor_generation, occurred_at, payload) values ($1,$2,$3,$4,$5,$6) on conflict do nothing',
    [evt.event_id, evt.event_type, evt.actor_id, evt.actor_generation, evt.occurred_at, JSON.stringify(evt.payload)],
  );

  switch (evt.event_type) {
    case 'discourse.entry_created':
    case 'entry.created': {
      await applyDelta(evt.actor_id, evt.actor_generation || 'unknown', WEIGHTS.entry);
      await bumpTopicGen(evt.occurred_at, (evt.payload as any)?.topic, evt.actor_generation, 'posts');
      await bumpVolatility(evt.occurred_at, (evt.payload as any)?.topic, { posts: 1 });
      await bumpGatheringImpact(evt.occurred_at, 'posts');
      break;
    }
    case 'discourse.reply_created':
    case 'entry.replied': {
      await applyDelta(evt.actor_id, evt.actor_generation || 'unknown', WEIGHTS.reply);
      await bumpTopicGen(evt.occurred_at, (evt.payload as any)?.topic, evt.actor_generation, 'replies');
      await bumpVolatility(evt.occurred_at, (evt.payload as any)?.topic, { replies: 1 });
      await bumpGatheringImpact(evt.occurred_at, 'replies');
      break;
    }
    case 'endorse.created':
    case 'endorsement.created': {
      const cross = Boolean(evt.payload?.cross_gen);
      const purge = purgeActive || Boolean(evt.payload?.during_purge);
      const weight = purge ? WEIGHTS.endorsementPurgeCross : cross ? WEIGHTS.endorsementCross : WEIGHTS.endorsementSame;
      await applyDelta(evt.actor_id, evt.actor_generation || 'unknown', weight, {
        crossGen: cross,
        purge,
        endorse: { crossGen: cross },
      });
      await bumpTopicGen(evt.occurred_at, (evt.payload as any)?.topic, evt.actor_generation, 'endorsements');
      await bumpVolatility(evt.occurred_at, (evt.payload as any)?.topic, { endorsements: 1 });
      await bumpGatheringImpact(evt.occurred_at, 'endorsements');
      break;
    }
    case 'cred.spent':
    case 'cred.spent.v1': {
      await applyDelta(evt.actor_id, evt.actor_generation || 'unknown', WEIGHTS.credSpent);
      break;
    }
    case 'cred.earned': {
      await applyDelta(evt.actor_id, evt.actor_generation || 'unknown', WEIGHTS.credEarned);
      break;
    }
    case 'safety.action': {
      await applyDelta(evt.actor_id, evt.actor_generation || 'unknown', WEIGHTS.safetyAction);
      break;
    }
    case 'purge.started': {
      purgeActive = true;
      break;
    }
    case 'purge.ended': {
      purgeActive = false;
      break;
    }
    case 'note.created': {
      const actor = (evt.payload as any)?.created_by || evt.actor_id;
      if (!actor) break;
      const gen = (evt.payload as any)?.created_by_generation || evt.actor_generation || 'unknown';
      await applyDelta(actor, gen, WEIGHTS.noteCreated);
      break;
    }
    case 'note.featured': {
      const actor = (evt.payload as any)?.actor_id || evt.actor_id;
      if (!actor) break;
      const gen = (evt.payload as any)?.actor_generation || evt.actor_generation || 'unknown';
      await applyDelta(actor, gen, WEIGHTS.noteFeatured, {
        crossGen: Boolean((evt.payload as any)?.cross_gen),
      });
      break;
    }
    case 'note.deprecated': {
      const actor = evt.actor_id;
      if (!actor) break;
      const gen = evt.actor_generation || 'unknown';
      await applyDelta(actor, gen, WEIGHTS.noteDeprecated);
      break;
    }
    default:
      break;
  }

  await pool.query('insert into trust_processed_events (event_id) values ($1) on conflict do nothing', [evt.event_id]);
  if (meta) {
    topicMetrics[meta.topic] = { partition: meta.partition, offset: meta.offset, last_event_ts: evt.occurred_at };
  }
};

const startConsumer = async () => {
  await runConsumer({
    groupId: 'trustgraph-consumer',
    topics: ['events.discourse.v1', 'events.endorse.v1', 'events.cred.v1', 'events.purge.v1', 'events.safety.v1'],
    handler: processEvent,
  });
};

app.get('/trust/user/:id', async (request, reply) => {
  const role = request.headers['x-ops-role'];
  if (!role) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const userId = (request.params as any)['id'];
  const rows = await pool.query('select * from trust_nodes where user_id=$1 order by updated_at desc', [userId]);
  const history = await pool.query(
    'select metric, value, created_at from trust_history where user_id=$1 order by created_at desc limit 20',
    [userId],
  );
  return { user_id: userId, nodes: rows.rows, history: history.rows };
});

// Internal, service-to-service batch lookup. Not exposed to external clients.
app.get('/internal/credibility', async (request, reply) => {
  if (!request.headers['x-internal-call']) {
    reply.status(401);
    return { error: 'internal only' };
  }
  const idsParam = String((request.query as any)?.ids ?? '');
  const ids = idsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  if (!ids.length) return { users: {} };
  const rows = await pool.query(
    'select user_id, credibility_score from trust_nodes where user_id = any($1::uuid[])',
    [ids],
  );
  const out: Record<string, number> = {};
  for (const r of rows.rows) out[r.user_id] = Number(r.credibility_score ?? 0);
  return { users: out };
});

const requireInsightsKey = (request: any, reply: any) => {
  if (!INSIGHTS_API_KEY) return true; // dev-open if not configured
  const k = (request.headers['x-insights-key'] as string | undefined) ?? '';
  if (k && k === INSIGHTS_API_KEY) return true;
  reply.status(401);
  return false;
};

const enforceKAnon = (rows: Array<{ count: number }>, minK: number) => rows.filter((r) => (r.count ?? 0) >= minK);

// --- Derived Insight Products (no user-level exports) ---
app.get('/insights/generation-divergence', async (request, reply) => {
  if (!requireInsightsKey(request, reply)) return { error: 'unauthorized' };
  const days = Math.min(90, Number((request.query as any)?.days ?? 30));
  const minK = Math.max(INSIGHTS_MIN_K, Number((request.query as any)?.min_k ?? INSIGHTS_MIN_K));
  const rows = await pool.query(
    `select topic, generation, sum(posts)::int as posts, sum(replies)::int as replies, sum(endorsements)::int as endorsements,
            (sum(posts)+sum(replies)+sum(endorsements))::int as count
     from semantic_topic_generation_daily
     where day >= (current_date - ($1::int || ' days')::interval)
     group by topic, generation
     order by count desc
     limit 500`,
    [days],
  );
  const safe = enforceKAnon(rows.rows as any, minK);
  return { window_days: days, min_k: minK, items: safe };
});

app.get('/insights/consensus-heatmap', async (request, reply) => {
  if (!requireInsightsKey(request, reply)) return { error: 'unauthorized' };
  const days = Math.min(90, Number((request.query as any)?.days ?? 30));
  const minK = Math.max(INSIGHTS_MIN_K, Number((request.query as any)?.min_k ?? INSIGHTS_MIN_K));
  const rows = await pool.query(
    `select day, topic, generation, (posts+replies+endorsements)::int as count
     from semantic_topic_generation_daily
     where day >= (current_date - ($1::int || ' days')::interval)
     order by day desc
     limit 5000`,
    [days],
  );
  const safe = enforceKAnon((rows.rows as any).map((r: any) => ({ ...r, count: Number(r.count ?? 0) })), minK);
  return { window_days: days, min_k: minK, points: safe };
});

app.get('/insights/topic-volatility', async (request, reply) => {
  if (!requireInsightsKey(request, reply)) return { error: 'unauthorized' };
  const days = Math.min(90, Number((request.query as any)?.days ?? 30));
  const minK = Math.max(INSIGHTS_MIN_K, Number((request.query as any)?.min_k ?? INSIGHTS_MIN_K));
  const rows = await pool.query(
    `select topic, sum(volatility)::numeric as volatility,
            (sum(posts)+sum(replies)+sum(endorsements))::int as count
     from semantic_topic_volatility_daily
     where day >= (current_date - ($1::int || ' days')::interval)
     group by topic
     order by volatility desc
     limit 200`,
    [days],
  );
  const safe = enforceKAnon((rows.rows as any).map((r: any) => ({ ...r, count: Number(r.count ?? 0) })), minK);
  return { window_days: days, min_k: minK, items: safe };
});

app.get('/insights/gathering-impact', async (request, reply) => {
  if (!requireInsightsKey(request, reply)) return { error: 'unauthorized' };
  const hours = Math.min(24 * 14, Number((request.query as any)?.hours ?? 48));
  const rows = await pool.query(
    `select hour, active, posts, replies, endorsements
     from semantic_gathering_impact_hourly
     where hour >= (now() - ($1::int || ' hours')::interval)
     order by hour asc`,
    [hours],
  );
  return { window_hours: hours, points: rows.rows };
});

app.get('/trust/history/:id', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const userId = (request.params as any)['id'];
  const history = await pool.query(
    'select metric, value, created_at from trust_history where user_id=$1 order by created_at desc limit 100',
    [userId],
  );
  return { user_id: userId, history: history.rows };
});

app.get('/trust/volatility', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const threshold = Number((request.query as any).threshold ?? 1);
  const res = await pool.query(
    'select * from trust_nodes where volatility_index >= $1 order by volatility_index desc limit 50',
    [threshold],
  );
  return { flags: res.rows };
});

app.post('/trust/recompute', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const body = (request.body as any) || {};
  const generation = body.generation as string | undefined;
  const dryRun = body.dry_run === true;

  const events = await pool.query('select * from trust_events order by occurred_at asc');

  if (!dryRun) {
    await pool.query('truncate trust_nodes, trust_edges, trust_history, trust_processed_events');
  }

  for (const evt of events.rows) {
    if (generation && evt.actor_generation && evt.actor_generation !== generation) continue;
    await processEvent({
      event_id: evt.event_id,
      event_type: evt.event_type,
      occurred_at: evt.occurred_at,
      actor_id: evt.actor_id,
      actor_generation: evt.actor_generation,
      correlation_id: undefined,
      payload: evt.payload,
      version: 'v1',
      context: undefined,
    });
  }

  const evt = await appendEvent('trust.recomputed', { scope: generation ?? 'all', dry_run: dryRun });
  return { recomputed: true, events: events.rowCount, event_id: evt.event_id };
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

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));
app.get('/metrics', async () => ({ status: 'ok' }));
app.get('/metrics/trustgraph', async () => ({ status: 'ok', topics: topicMetrics }));

const start = async () => {
  const port = Number(process.env.PORT ?? 4007);
  await app.ready();
  startConsumer().catch((err) => app.log.error(err, 'consumer failed'));
  setInterval(() => dispatchOutbox(pool, async (topic, payload) => publishEvent(topic, payload)), 10000);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`trustgraph running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start trustgraph');
  process.exit(1);
});

