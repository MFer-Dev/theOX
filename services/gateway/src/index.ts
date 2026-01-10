import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ensureCorrelationId, checkRateLimit, verifyAccess } from '@platform/shared';

const BODY_LIMIT = Number(process.env.GATEWAY_BODY_LIMIT ?? 25 * 1024 * 1024);

const app = Fastify({
  logger: true,
  bodyLimit: BODY_LIMIT,
});

const normalizePathForRateLimit = (url: string) => {
  const raw = String(url ?? '').split('?')[0];
  return raw
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
    .replace(/\/\d{2,}/g, '/:num')
    .slice(0, 160);
};

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

type SessionCacheEntry = { active: boolean; expiresAtMs: number };
const sessionCache = new Map<string, SessionCacheEntry>();

const isPublicPath = (url: string) => {
  if (url === '/healthz' || url === '/readyz') return true;
  if (url.startsWith('/docs')) return true;
  if (url.startsWith('/world/')) return true;
  // Allow auth + verification primitives without gateway-side enforcement
  if (url.startsWith('/identity/auth/login')) return true;
  if (url.startsWith('/identity/auth/register')) return true;
  if (url.startsWith('/identity/register')) return true;
  if (url.startsWith('/identity/auth/refresh')) return true;
  if (url.startsWith('/identity/otp/')) return true;
  if (url.startsWith('/identity/verify-otp')) return true;
  if (url.startsWith('/identity/password/')) return true;
  return false;
};

const isSessionActive = async (sid: string, correlationId: string) => {
  const now = Date.now();
  const cached = sessionCache.get(sid);
  if (cached && cached.expiresAtMs > now) return cached.active;
  try {
    const res = await (globalThis as any).fetch(`${targets.identity}/internal/session/active/${encodeURIComponent(sid)}`, {
      headers: { 'x-internal-call': 'true', 'x-correlation-id': correlationId },
    });
    const json = await res.json();
    const active = Boolean(json?.active);
    sessionCache.set(sid, { active, expiresAtMs: now + (active ? 5000 : 15000) });
    return active;
  } catch {
    // Fail open if identity is unavailable; services still validate tokens.
    return true;
  }
};

// Session enforcement at the edge: if an access token includes sid, ensure the session is active.
app.addHook('preHandler', async (request, reply) => {
  if (isPublicPath(request.url)) return;
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return;
  const token = authHeader.slice('Bearer '.length);
  const payload = verifyAccess(token);
  if (!payload) return;
  const sid = payload.sid;
  if (!sid) return;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const active = await isSessionActive(sid, correlationId);
  if (!active) {
    reply.status(401).send({ error: 'session_revoked' });
  }
});

// Basic global rate limiting at the edge (best-effort; if Redis is unavailable we fail open).
app.addHook('preHandler', async (request, reply) => {
  try {
    const ip = (request.headers['x-forwarded-for'] as string | undefined) ?? request.ip ?? 'unknown';
    const path = normalizePathForRateLimit(request.routerPath ?? request.url);
    const key = `edge:${ip}:${request.method}:${path}`;
    const r = await checkRateLimit(key, 600, 60);
    reply.header('x-rate-limit', r.allowed ? 'ok' : 'blocked');
    if (!r.allowed) {
      reply.status(429).send({ error: 'rate_limited' });
      return;
    }
  } catch {
    reply.header('x-rate-limit', 'skip');
  }
});

app.register(swagger, {
  openapi: {
    info: {
      title: 'Gateway Service',
      version: '0.0.1',
    },
  },
});

app.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false,
  },
});

const targets = {
  identity: process.env.IDENTITY_BASE_URL ?? 'http://localhost:4001',
  discourse: process.env.DISCOURSE_BASE_URL ?? 'http://localhost:4002',
  endorse: process.env.ENDORSE_BASE_URL ?? 'http://localhost:4005',
  cred: process.env.CRED_BASE_URL ?? 'http://localhost:4004',
  purge: process.env.PURGE_BASE_URL ?? 'http://localhost:4003',
  notes: process.env.NOTES_BASE_URL ?? 'http://localhost:4006',
  safety: process.env.SAFETY_BASE_URL ?? 'http://localhost:4008',
  notifications: process.env.NOTIFICATIONS_BASE_URL ?? 'http://localhost:4009',
  search: process.env.SEARCH_BASE_URL ?? 'http://localhost:4010',
  trust: process.env.TRUST_BASE_URL ?? 'http://localhost:4007',
  insights: process.env.INSIGHTS_BASE_URL ?? 'http://localhost:4015',
  ai: process.env.AI_BASE_URL ?? 'http://localhost:4016',
  messaging: process.env.MESSAGING_BASE_URL ?? 'http://localhost:4011',
  lists: process.env.LISTS_BASE_URL ?? 'http://localhost:4012',
};

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));

// World clock: a single contract clients/services can consume.
// This is intentionally served from gateway so mobile only has one place to read from.
app.get('/world/clock', async (_request, reply) => {
  try {
    const res = await (globalThis as any).fetch(`${targets.purge}/purge/status`);
    const json = await res.json();
    reply.status(res.status);
    return json;
  } catch {
    reply.status(503);
    return { error: 'unavailable' };
  }
});

// Realtime world stream (SSE): emits world.tick/world.start/world.end events.
// No auth (public), low payload, and clients reconnect with backoff.
app.get('/world/stream', async (request, reply) => {
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
  });
  // flush headers
  (reply.raw as any).flushHeaders?.();

  let lastActive: boolean | null = null;
  let lastEndsAt: string | null = null;
  let closed = false;

  const send = (event: string, data: any) => {
    if (closed) return;
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // initial ping so clients know stream is alive
  send('world.tick', { ok: true, ts: new Date().toISOString() });

  const tick = async () => {
    try {
      const res = await (globalThis as any).fetch(`${targets.purge}/purge/status`);
      const json = await res.json();
      const active = Boolean(json?.active);
      const endsAt = (json?.ends_at ?? null) as string | null;
      send('world.tick', { ...json, ts: new Date().toISOString() });
      if (lastActive !== null && active !== lastActive) {
        send(active ? 'world.start' : 'world.end', { ...json, ts: new Date().toISOString() });
      }
      if (lastEndsAt && endsAt && endsAt !== lastEndsAt) {
        // window changed (reschedule, etc)
        send('world.tick', { ...json, ts: new Date().toISOString(), changed: 'ends_at' });
      }
      lastActive = active;
      lastEndsAt = endsAt;
    } catch {
      send('world.tick', { ok: false, ts: new Date().toISOString() });
    }
  };

  const id = setInterval(tick, 1000);
  request.raw.on('close', () => {
    closed = true;
    clearInterval(id);
  });

  return reply;
});

type ProxyConfig = { prefix: string; target: string; preservePrefix?: boolean };

const opsGatewayUrl = process.env.OPS_GATEWAY_URL ?? 'http://localhost:4013';
const opsInternalKey = process.env.OPS_INTERNAL_KEY ?? 'dev_internal';

const normalizeRouteForFingerprint = (route: string) => {
  const raw = String(route ?? '').split('?')[0];
  // Reduce cardinality by replacing obvious IDs.
  return raw
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
    .replace(/\/\d{2,}/g, '/:num')
    .slice(0, 160);
};

const reportOpsError = async (args: {
  correlationId: string;
  service: string;
  route: string;
  method?: string;
  status?: number;
  message: string;
}) => {
  const routeKey = normalizeRouteForFingerprint(args.route);
  const fp = `${args.service}:${args.method ?? 'GET'}:${routeKey}:${args.status ?? 'x'}:${args.message}`.slice(0, 180);
  try {
    await (globalThis as any).fetch(`${opsGatewayUrl}/ops/observability/report-error`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': args.correlationId,
        'x-internal-call': 'true',
        'x-internal-key': opsInternalKey,
        'x-ops-user': 'gateway',
      },
      body: JSON.stringify({
        fingerprint: fp,
        service: args.service,
        route: routeKey,
        status: args.status ?? null,
        message: args.message,
        meta: { source: 'gateway_proxy', method: args.method ?? null, raw_route: args.route },
      }),
    });
  } catch {
    // ignore
  }
};

const registerProxy = (cfg: ProxyConfig) => {
  app.all(`${cfg.prefix}/*`, async (request, reply) => {
    const stripped = request.url.replace(cfg.prefix, '');
    const path = cfg.preservePrefix ? request.url : stripped;
    const targetUrl = `${cfg.target}${path}`;
    const method = request.method;
    const headers = { ...request.headers } as Record<string, string>;
    // Do not forward host
    delete headers.host;
    const body =
      request.body && typeof request.body === 'object' && !(request.body instanceof Buffer)
        ? JSON.stringify(request.body)
        : (request.body as any);
    const correlationId = String(request.headers['x-correlation-id'] ?? '');
    try {
      const res = await (globalThis as any).fetch(targetUrl, {
        method,
        headers,
        body: ['GET', 'HEAD'].includes(method) ? undefined : body,
      });
      const buf = Buffer.from(await res.arrayBuffer());
      reply.status(res.status);
      for (const [k, v] of res.headers.entries()) {
        if (k.toLowerCase() === 'content-length') continue;
        reply.header(k, v);
      }
      if (res.status >= 500) {
        await reportOpsError({
          correlationId,
          service: cfg.prefix.replace('/', '') || 'unknown',
          route: String(request.url),
          method,
          status: res.status,
          message: `upstream_${res.status}`,
        });
      }
      return reply.send(buf);
    } catch (e: any) {
      await reportOpsError({
        correlationId,
        service: cfg.prefix.replace('/', '') || 'unknown',
        route: String(request.url),
        method,
        status: 503,
        message: e?.message ?? 'upstream_unreachable',
      });
      reply.status(503);
      return reply.send({ error: 'unavailable' });
    }
  });
};

registerProxy({ prefix: '/identity', target: targets.identity });
registerProxy({ prefix: '/discourse', target: targets.discourse });
registerProxy({ prefix: '/endorse', target: targets.endorse });
registerProxy({ prefix: '/cred', target: targets.cred, preservePrefix: true });
registerProxy({ prefix: '/purge', target: targets.purge, preservePrefix: true });
registerProxy({ prefix: '/notes', target: targets.notes, preservePrefix: true });
registerProxy({ prefix: '/safety', target: targets.safety, preservePrefix: true });
registerProxy({ prefix: '/notifications', target: targets.notifications, preservePrefix: true });
registerProxy({ prefix: '/search', target: targets.search, preservePrefix: true });
registerProxy({ prefix: '/trust', target: targets.trust, preservePrefix: true });
registerProxy({ prefix: '/insights', target: targets.insights, preservePrefix: true });
registerProxy({ prefix: '/ai', target: targets.ai, preservePrefix: true });
registerProxy({ prefix: '/messaging', target: targets.messaging, preservePrefix: true });
registerProxy({ prefix: '/lists', target: targets.lists });

const start = async () => {
  const port = Number(process.env.PORT ?? 4000);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`gateway running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start gateway');
  process.exit(1);
});

