import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ensureCorrelationId, verifyAccess, getPool, rateLimitMiddleware } from '@platform/shared';

const app = Fastify({ logger: true });
const pool = getPool('notifications');
const purgeUrl = process.env.PURGE_URL ?? 'http://localhost:4003';

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, {
  openapi: { info: { title: 'Notifications Service', version: '0.0.1' } },
});
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
  return `notifications:${action}:${auth?.sub ?? 'anon'}:${device}:${ip}`;
};

const getPurgeStatus = async () => {
  try {
    const res = await fetch(`${purgeUrl}/purge/status`);
    return (await res.json()) as { active: boolean; starts_at?: string | null; ends_at?: string | null };
  } catch {
    return { active: false, starts_at: null, ends_at: null };
  }
};

app.get('/notifications', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const ps = await getPurgeStatus();
  const items: any[] = [];
  if (ps.starts_at && !ps.active) {
    items.push({
      id: 'n_gathering_countdown',
      title: 'The Gathering is approaching',
      body: 'Cross-Trybe visibility opens automatically at the scheduled time.',
      ts: 'soon',
      unread: true,
      target: { route: 'Home' },
    });
  }
  if (ps.active) {
    items.push({
      id: 'n_gathering_live',
      title: 'The Gathering is live',
      body: 'Global cross-Trybe timeline is open for a limited time.',
      ts: 'now',
      unread: true,
      target: { route: 'Home' },
    });
  }
  return { notifications: items, purge_active: ps.active };
});

// Device registration (push token). This is a stub until APNs/FCM delivery is wired.
app.post('/devices/register', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: rlKey(request, auth, 'register'), limit: 10, windowSec: 60 })(request, reply);
  if ((reply as any).sent) return reply;
  const body = (request.body ?? {}) as { platform?: string; token?: string };
  const platform = String(body.platform ?? '').toLowerCase();
  const token = String(body.token ?? '').trim();
  if (!token || (platform !== 'ios' && platform !== 'android')) {
    reply.status(400);
    return { error: 'platform (ios|android) and token required' };
  }
  await pool.query(
    `insert into push_devices (user_id, platform, token, last_seen_at)
     values ($1,$2,$3,now())
     on conflict (platform, token)
     do update set user_id=excluded.user_id, last_seen_at=now(), updated_at=now(), revoked_at=null`,
    [auth.sub, platform, token],
  );
  return { ok: true };
});

app.post('/devices/unregister', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await rateLimitMiddleware({ key: rlKey(request, auth, 'unregister'), limit: 10, windowSec: 60 })(request, reply);
  if ((reply as any).sent) return reply;
  const body = (request.body ?? {}) as { platform?: string; token?: string };
  const platform = String(body.platform ?? '').toLowerCase();
  const token = String(body.token ?? '').trim();
  if (!token || (platform !== 'ios' && platform !== 'android')) {
    reply.status(400);
    return { error: 'platform (ios|android) and token required' };
  }
  await pool.query('update push_devices set revoked_at=now(), updated_at=now() where user_id=$1 and platform=$2 and token=$3', [
    auth.sub,
    platform,
    token,
  ]);
  return { ok: true };
});

// Placeholder internal "send" endpoint (no delivery yet).
app.post('/notifications/send', async () => ({ sent: true, stub: true }));

const start = async () => {
  const port = Number(process.env.PORT ?? 4009);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`notifications running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start notifications');
  process.exit(1);
});

