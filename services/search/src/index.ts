import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ensureCorrelationId, getPool, verifyAccess } from '@platform/shared';

const app = Fastify({ logger: true });
const discoursePool = getPool('discourse');
const identityPool = getPool('identity');
const purgeUrl = process.env.PURGE_URL ?? 'http://localhost:4003';

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, { openapi: { info: { title: 'Search Service', version: '0.0.1' } } });
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));

const getAuth = (request: any) => {
  const header = request.headers.authorization;
  if (!header) return null;
  return verifyAccess(header.replace('Bearer ', ''));
};

const getPurgeStatus = async () => {
  try {
    const res = await fetch(`${purgeUrl}/purge/status`);
    return (await res.json()) as { active: boolean };
  } catch {
    return { active: false };
  }
};

app.get('/search', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const q = String((request.query as any)?.q ?? '').trim();
  const type = String((request.query as any)?.type ?? 'all');
  const trybe = String((request.query as any)?.trybe ?? '').trim();
  if (!q) return { results: { posts: [], users: [], topics: [] } };

  const purge = await getPurgeStatus();
  const gen = purge.active ? null : auth.generation;
  const scopeGen = trybe ? trybe : gen;

  const users =
    type === 'all' || type === 'users'
      ? (
          await identityPool.query(
            scopeGen
              ? `select id, handle, display_name, avatar_url, generation from users
                 where generation=$1 and (handle ilike $2 or coalesce(display_name,'') ilike $2)
                 order by created_at desc limit 20`
              : `select id, handle, display_name, avatar_url, generation from users
                 where (handle ilike $1 or coalesce(display_name,'') ilike $1)
                 order by created_at desc limit 20`,
            scopeGen ? [scopeGen, `%${q}%`] : [`%${q}%`],
          )
        ).rows
      : [];

  const posts =
    type === 'all' || type === 'posts'
      ? (
          await discoursePool.query(
            scopeGen
              ? `select id, body, topic, generation, created_at, user_id from entries
                 where generation=$1 and (body ilike $2 or coalesce(topic,'') ilike $2)
                 order by created_at desc limit 30`
              : `select id, body, topic, generation, created_at, user_id from entries
                 where (body ilike $1 or coalesce(topic,'') ilike $1)
                 order by created_at desc limit 30`,
            scopeGen ? [scopeGen, `%${q}%`] : [`%${q}%`],
          )
        ).rows
      : [];

  const topics =
    type === 'all' || type === 'topics'
      ? (
          await discoursePool.query(
            scopeGen
              ? `select topic, count(*)::int as count from entries where generation=$1 and topic is not null and topic ilike $2 group by topic order by count desc limit 20`
              : `select topic, count(*)::int as count from entries where topic is not null and topic ilike $1 group by topic order by count desc limit 20`,
            scopeGen ? [scopeGen, `%${q}%`] : [`%${q}%`],
          )
        ).rows
      : [];

  return {
    results: {
      users: users.map((u: any) => ({ id: u.id, handle: u.handle, display_name: u.display_name, avatar_url: u.avatar_url, generation: u.generation })),
      posts: posts.map((p: any) => ({ id: p.id, body: p.body, topic: p.topic, generation: p.generation, created_at: p.created_at, author_id: p.user_id })),
      topics,
    },
    purge_active: purge.active,
  };
});

const start = async () => {
  const port = Number(process.env.PORT ?? 4010);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`search running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start search');
  process.exit(1);
});

