import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ensureCorrelationId, getPool } from '@platform/shared';

const app = Fastify({ logger: true });
const pool = getPool('insights');
const ALGO_VERSION = 'v1';

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, { openapi: { info: { title: 'Insights Service', version: '0.0.1' } } });
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

const MIN_COHORT = 10;

const ensureAuth = (request: any) => {
  const apiKey = process.env.INSIGHTS_API_KEY || 'insights-key';
  return request.headers['x-insights-key'] === apiKey;
};

const runQuery = async (sql: string, params: any[] = []) => {
  const res = await pool.query(sql, params);
  return res.rows;
};

const enforceMinCohort = (rows: any[], countField: string) => {
  return rows.filter((r) => Number(r[countField]) >= MIN_COHORT);
};

// Product: generational discourse divergence (counts per generation)
app.get('/insights/generation/divergence', async (request, reply) => {
  if (!ensureAuth(request)) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const rows = await runQuery(
    `select generation, count(*) as entries
     from entries
     group by generation
     order by entries desc`,
  );
  return { product: 'generation_divergence', data: enforceMinCohort(rows, 'entries'), algo_version: ALGO_VERSION };
});

// Product: topic-level volatility (using trust_history volatility_index aggregates)
app.get('/insights/topics/volatility', async (request, reply) => {
  if (!ensureAuth(request)) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const rows = await runQuery(
    `select topic, avg(endorse_count + reply_count) as activity, count(*) as items
     from timeline_items
     where topic is not null
     group by topic
     order by activity desc
     limit 50`,
  );
  return { product: 'topic_volatility', data: enforceMinCohort(rows, 'items'), algo_version: ALGO_VERSION };
});

// Product: purge impact summary
app.get('/insights/purge/impact', async (request, reply) => {
  if (!ensureAuth(request)) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const rows = await runQuery(
    `select
        date_trunc('hour', occurred_at) as hour,
        sum(case when event_type = 'purge.started' then 1 else 0 end) as starts,
        sum(case when event_type = 'purge.ended' then 1 else 0 end) as ends,
        sum(case when event_type = 'discourse.reply_created' then 1 else 0 end) as replies,
        sum(case when event_type = 'endorse.created' then 1 else 0 end) as endorsements
     from events
     where event_type in ('purge.started','purge.ended','discourse.reply_created','endorse.created')
     group by hour
     order by hour desc
     limit 48`,
  );
  return { product: 'purge_impact', data: rows, algo_version: ALGO_VERSION };
});

// Product: consensus/ contention heatmap (counts by generation/topic)
app.get('/insights/consensus', async (request, reply) => {
  if (!ensureAuth(request)) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const rows = await runQuery(
    `select generation, topic, count(*) as items
     from timeline_items
     where topic is not null
     group by generation, topic
     order by items desc
     limit 100`,
  );
  return { product: 'consensus_heatmap', data: enforceMinCohort(rows, 'items'), algo_version: ALGO_VERSION };
});

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));
app.get('/metrics', async () => ({ status: 'ok' }));
app.get('/insights/metrics', async () => ({ status: 'ok', min_cohort: MIN_COHORT, algo_version: ALGO_VERSION }));

const start = async () => {
  const port = Number(process.env.PORT ?? 4015);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`insights running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start insights');
  process.exit(1);
});

