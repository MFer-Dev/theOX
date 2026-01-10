import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  ensureCorrelationId,
  hashValue,
  compareHash,
  GenerationCohort,
  getPool,
  withIdempotency,
  recordOutbox,
  dispatchOutbox,
  rateLimitMiddleware,
} from '@platform/shared';
import { buildEvent, persistEvent, publishEvent } from '@platform/events';
import { signTokens, verifyAccess, verifyRefresh } from '@platform/shared';

const pool = getPool('identity');
const trustUrl = process.env.TRUST_URL ?? 'http://localhost:4007';

// Versioned policy IDs (must be immutable once shipped).
const POLICY_TERMS_ID = process.env.POLICY_TERMS_ID ?? 'terms_v1';
const POLICY_PRIVACY_ID = process.env.POLICY_PRIVACY_ID ?? 'privacy_v1';

const app = Fastify({
  logger: true,
});

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, {
  openapi: {
    info: {
      title: 'Identity Service',
      version: '0.1.0',
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
  const topic = 'events.identity.v1';
  try {
    await publishEvent(topic, evt);
  } catch (err: any) {
    await recordOutbox(pool, topic, evt.event_id, evt);
  }
  return evt;
};

const getAuthUser = (request: any) => {
  const header = request.headers.authorization;
  if (!header) return null;
  const token = header.replace('Bearer ', '');
  return verifyAccess(token);
};

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));

// Internal session check (gateway enforcement). Requires x-internal-call header.
app.get('/internal/session/active/:sid', async (request, reply) => {
  if (!request.headers['x-internal-call']) {
    reply.status(401);
    return { error: 'internal only' };
  }
  const sid = (request.params as any).sid as string;
  if (!sid) {
    reply.status(400);
    return { error: 'sid required' };
  }
  const row = await pool.query(
    `select 1
     from sessions s
     join users u on u.id = s.user_id
     where s.id=$1 and s.revoked_at is null and s.expires_at > now() and u.deleted_at is null`,
    [sid],
  );
  return { active: (row.rowCount ?? 0) > 0 };
});

app.post('/auth/register', async (request, reply) => {
  const body = request.body as { handle?: string; password?: string };
  if (!body.handle || !body.password) {
    reply.status(400);
    return { error: 'handle and password required' };
  }
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const result = await withIdempotency(pool, idempotencyKey, async () => {
    const hash = await hashValue(body.password!);
    const userRes = await pool.query(
      'insert into users (handle, password_hash) values ($1, $2) returning id, handle, created_at, generation, is_verified',
      [body.handle, hash],
    );
    const user = userRes.rows[0];
    const evt = await appendEvent(
      'identity.user_registered',
      { user_id: user.id, handle: body.handle },
      user.id,
      null,
      correlationId,
      idempotencyKey,
    );
    // initialize cred via cred service
    fetch(process.env.CRED_URL ?? 'http://localhost:4004/internal/init-balance', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': correlationId ?? '', 'x-idempotency-key': idempotencyKey ?? '' },
      body: JSON.stringify({ user_id: user.id }),
    }).catch((err) => request.log.error(err, 'init cred failed'));
    return { user, event: evt };
  });
  return result;
});

// Compatibility alias (mobile contract): POST /identity/register
app.post('/register', async (request, reply) => {
  return app.inject({
    method: 'POST',
    url: '/auth/register',
    headers: request.headers as any,
    payload: request.body as any,
  }).then((res) => {
    reply.status(res.statusCode);
    return res.json();
  });
});

app.post('/auth/login', async (request, reply) => {
  const body = request.body as { handle?: string; password?: string };
  if (!body.handle || !body.password) {
    reply.status(400);
    return { error: 'handle and password required' };
  }
  const userRes = await pool.query('select * from users where handle=$1 and deleted_at is null', [body.handle]);
  if (userRes.rowCount === 0) {
    reply.status(401);
    return { error: 'invalid credentials' };
  }
  const user = userRes.rows[0];
  const ok = await compareHash(body.password, user.password_hash);
  if (!ok) {
    reply.status(401);
    return { error: 'invalid credentials' };
  }
  const deviceFingerprint =
    (request.headers['x-device-id'] as string | undefined) ??
    (request.headers['x-device-fingerprint'] as string | undefined) ??
    null;
  const sessionId = crypto.randomUUID();
  const tokens = signTokens({
    sub: user.id,
    generation: user.generation as GenerationCohort | null,
    verified: user.is_verified,
    sid: sessionId,
  });
  const refreshHash = await hashValue(tokens.refreshToken);
  await pool.query(
    'insert into sessions (id, user_id, refresh_token_hash, device_fingerprint, last_active_at, expires_at) values ($1, $2, $3, $4, now(), now() + interval \'30 days\')',
    [sessionId, user.id, refreshHash, deviceFingerprint],
  );
  return { access_token: tokens.accessToken, refresh_token: tokens.refreshToken };
});

app.post('/auth/refresh', async (request, reply) => {
  const body = request.body as { refresh_token?: string };
  if (!body.refresh_token) {
    reply.status(400);
    return { error: 'refresh_token required' };
  }
  const payload = verifyRefresh(body.refresh_token);
  if (!payload) {
    reply.status(401);
    return { error: 'invalid token' };
  }
  if (!payload.sid) {
    reply.status(401);
    return { error: 'invalid token' };
  }
  const row = await pool.query(
    `select s.id, s.refresh_token_hash, s.expires_at, s.device_fingerprint, u.deleted_at
     from sessions s
     join users u on u.id = s.user_id
     where s.id=$1 and s.user_id=$2`,
    [payload.sid, payload.sub],
  );
  if (!row.rowCount) {
    reply.status(401);
    return { error: 'invalid token' };
  }
  const session = row.rows[0];
  if (session.deleted_at) {
    await pool.query('update sessions set revoked_at=now() where id=$1', [payload.sid]);
    reply.status(401);
    return { error: 'account_deleted' };
  }
  const ok = await compareHash(body.refresh_token, session.refresh_token_hash);
  if (!ok) {
    reply.status(401);
    return { error: 'invalid token' };
  }
  const exp = session.expires_at ? new Date(session.expires_at).getTime() : 0;
  if (exp && Date.now() > exp) {
    reply.status(401);
    return { error: 'expired' };
  }
  const deviceFingerprint =
    (request.headers['x-device-id'] as string | undefined) ??
    (request.headers['x-device-fingerprint'] as string | undefined) ??
    null;
  if (session.device_fingerprint && deviceFingerprint && session.device_fingerprint !== deviceFingerprint) {
    reply.status(401);
    return { error: 'device_mismatch' };
  }

  // Rotate refresh token in-place (single active refresh per session).
  const tokens = signTokens({
    sub: payload.sub,
    generation: payload.generation as any,
    verified: Boolean(payload.verified),
    sid: payload.sid,
  });
  const refreshHash = await hashValue(tokens.refreshToken);
  await pool.query(
    'update sessions set refresh_token_hash=$2, last_active_at=now(), expires_at=now() + interval \'30 days\' where id=$1 and revoked_at is null',
    [payload.sid, refreshHash],
  );
  return { access_token: tokens.accessToken, refresh_token: tokens.refreshToken };
});

app.post('/auth/logout', async (request, reply) => {
  const auth = getAuthUser(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  if (!auth.sid) {
    reply.status(400);
    return { error: 'missing_sid' };
  }
  await pool.query('update sessions set revoked_at=now() where id=$1 and user_id=$2', [auth.sid, auth.sub]);
  return { ok: true };
});

app.post('/auth/logout_all', async (request, reply) => {
  const auth = getAuthUser(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  await pool.query('update sessions set revoked_at=now() where user_id=$1', [auth.sub]);
  return { ok: true };
});

app.post('/verify/ageband', async (request, reply) => {
  const user = getAuthUser(request);
  if (!user) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const body = request.body as { generation: GenerationCohort };
  if (!body.generation) {
    reply.status(400);
    return { error: 'generation required' };
  }
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  await pool.query('update users set generation=$1, is_verified=true where id=$2', [
    body.generation,
    user.sub,
  ]);
  const evt = await appendEvent(
    'identity.generation_verified',
    { user_id: user.sub, generation: body.generation },
    user.sub,
    body.generation,
    correlationId,
  );
  return { verified: true, event: evt };
});

// Compatibility + onboarding contracts used by mobile:
// - POST /identity/generation/set { generation }
// - POST /identity/generation/verify { code } (stub ok)
app.post('/generation/set', async (request, reply) => {
  const user = getAuthUser(request);
  if (!user) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const body = request.body as { generation?: GenerationCohort };
  if (!body.generation) {
    reply.status(400);
    return { error: 'generation required' };
  }
  await pool.query('update users set generation=$1 where id=$2', [body.generation, user.sub]);
  return { ok: true, generation: body.generation };
});

app.post('/generation/verify', async (request, reply) => {
  const user = getAuthUser(request);
  if (!user) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const body = request.body as { code?: string };
  if (!body.code) {
    reply.status(400);
    return { error: 'code required' };
  }
  const res = await pool.query('select generation from users where id=$1', [user.sub]);
  const generation = res.rows[0]?.generation as GenerationCohort | undefined;
  if (!generation) {
    reply.status(400);
    return { error: 'generation not set' };
  }
  // Stub verification: accept any non-empty code.
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  await pool.query('update users set is_verified=true where id=$1', [user.sub]);
  const evt = await appendEvent(
    'identity.generation_verified',
    { user_id: user.sub, generation },
    user.sub,
    generation,
    correlationId,
  );
  return { verified: true, event: evt };
});

// OTP verification stub (mobile signup flow). Kept intentionally minimal until provider integration exists.
app.post('/otp/send', async (request, reply) => {
  const body = request.body as { contact?: string; purpose?: string };
  if (!body.contact) {
    reply.status(400);
    return { error: 'contact required' };
  }
  const contact = String(body.contact).trim().toLowerCase();
  const purpose = String(body.purpose ?? 'verify');
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const deviceFingerprint =
    (request.headers['x-device-id'] as string | undefined) ??
    (request.headers['x-device-fingerprint'] as string | undefined) ??
    'unknown';

  await rateLimitMiddleware({
    key: `otp:send:${deviceFingerprint}:${contact}`,
    limit: 5,
    windowSec: 60 * 10,
    cooldownSec: 60 * 30,
    cooldownThreshold: 8,
  })(request, reply);

  // Provider abstraction placeholder: for now we generate + persist and log (dev).
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await hashValue(code);
  await pool.query(
    'insert into otp_codes (contact, code_hash, purpose, expires_at) values ($1,$2,$3, now() + interval \'10 minutes\')',
    [contact, codeHash, purpose],
  );
  request.log.info({ contact, purpose, correlationId, code }, 'otp generated (dev)');

  return {
    ok: true,
    // Never return the code in production. In dev, allow UI testing.
    ...(process.env.ALLOW_OTP_DEBUG === '1' ? { debug_code: code } : {}),
  };
});

app.post('/verify-otp', async (request, reply) => {
  const body = request.body as { contact?: string; code?: string; purpose?: string };
  if (!body.contact || !body.code) {
    reply.status(400);
    return { error: 'contact and code required' };
  }
  const contact = String(body.contact).trim().toLowerCase();
  const purpose = String(body.purpose ?? 'verify');
  const deviceFingerprint =
    (request.headers['x-device-id'] as string | undefined) ??
    (request.headers['x-device-fingerprint'] as string | undefined) ??
    'unknown';

  await rateLimitMiddleware({
    key: `otp:verify:${deviceFingerprint}:${contact}`,
    limit: 10,
    windowSec: 60 * 10,
    cooldownSec: 60 * 30,
    cooldownThreshold: 16,
  })(request, reply);

  const rows = await pool.query(
    `select id, code_hash, attempts, expires_at, consumed_at
     from otp_codes
     where contact=$1 and purpose=$2
     order by created_at desc
     limit 1`,
    [contact, purpose],
  );
  if (!rows.rowCount) {
    reply.status(401);
    return { error: 'invalid_code' };
  }
  const otp = rows.rows[0];
  const exp = otp.expires_at ? new Date(otp.expires_at).getTime() : 0;
  if (otp.consumed_at || (exp && Date.now() > exp) || (otp.attempts ?? 0) >= 8) {
    reply.status(401);
    return { error: 'invalid_code' };
  }
  const ok = await compareHash(String(body.code), otp.code_hash);
  await pool.query('update otp_codes set attempts=attempts+1 where id=$1', [otp.id]);
  if (!ok) {
    reply.status(401);
    return { error: 'invalid_code' };
  }
  await pool.query('update otp_codes set consumed_at=now() where id=$1', [otp.id]);
  return { ok: true };
});

app.get('/me', async (request, reply) => {
  const user = getAuthUser(request);
  if (!user) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const res = await pool.query(
    'select id, handle, generation, is_verified, display_name, bio, avatar_url, created_at from users where id=$1 and deleted_at is null',
    [user.sub],
  );
  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'not found' };
  }
  let scs: number | null = null;
  try {
    const t = await fetch(`${trustUrl}/trust/user/${res.rows[0].id}`);
    if (t.ok) {
      const json: any = await t.json();
      scs = Number(json?.user?.credibility_score ?? json?.node?.credibility_score ?? json?.credibility_score);
      if (!Number.isFinite(scs)) scs = null;
    }
  } catch {
    scs = null;
  }
  return { user: { ...res.rows[0], scs } };
});

// --- Policy / Terms / Privacy acceptance (versioned) ---
app.get('/policy/current', async () => {
  return {
    terms: { id: POLICY_TERMS_ID },
    privacy: { id: POLICY_PRIVACY_ID },
  };
});

app.get('/policy/status', async (request, reply) => {
  const user = getAuthUser(request);
  if (!user) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const rows = await pool.query(
    'select policy_id from policy_acceptances where user_id=$1 and policy_id = any($2::text[])',
    [user.sub, [POLICY_TERMS_ID, POLICY_PRIVACY_ID]],
  );
  const set = new Set((rows.rows ?? []).map((r: any) => String(r.policy_id)));
  return {
    accepted: {
      terms: set.has(POLICY_TERMS_ID),
      privacy: set.has(POLICY_PRIVACY_ID),
    },
    current: { terms: POLICY_TERMS_ID, privacy: POLICY_PRIVACY_ID },
  };
});

app.post('/policy/accept', async (request, reply) => {
  const user = getAuthUser(request);
  if (!user) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const body = (request.body ?? {}) as { terms?: boolean; privacy?: boolean };
  const wantsTerms = Boolean(body.terms);
  const wantsPrivacy = Boolean(body.privacy);
  if (!wantsTerms || !wantsPrivacy) {
    reply.status(400);
    return { error: 'terms_and_privacy_required' };
  }
  await pool.query(
    'insert into policy_acceptances (user_id, policy_id) values ($1, $2) on conflict do nothing',
    [user.sub, POLICY_TERMS_ID],
  );
  await pool.query(
    'insert into policy_acceptances (user_id, policy_id) values ($1, $2) on conflict do nothing',
    [user.sub, POLICY_PRIVACY_ID],
  );
  return { ok: true, accepted: { terms: true, privacy: true }, current: { terms: POLICY_TERMS_ID, privacy: POLICY_PRIVACY_ID } };
});

// Internal lookup for service-to-service hydration (Discourse, Notifications, Search)
app.get('/internal/users/:id', async (request, reply) => {
  if (!request.headers['x-internal-call']) {
    reply.status(401);
    return { error: 'internal only' };
  }
  const id = (request.params as any).id as string;
  const res = await pool.query(
    'select id, handle, generation, is_verified, display_name, bio, avatar_url, created_at from users where id=$1 and deleted_at is null',
    [id],
  );
  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'not found' };
  }
  return { user: res.rows[0] };
});

// Update profile (mobile contract)
app.post('/profile/update', async (request, reply) => {
  const user = getAuthUser(request);
  if (!user) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const exists = await pool.query('select 1 from users where id=$1 and deleted_at is null', [user.sub]);
  if (!exists.rowCount) {
    reply.status(403);
    return { error: 'account_deleted' };
  }
  const body = request.body as { display_name?: string; bio?: string; avatar_url?: string };
  await pool.query('update users set display_name=$2, bio=$3, avatar_url=$4 where id=$1', [
    user.sub,
    body.display_name ?? null,
    body.bio ?? null,
    body.avatar_url ?? null,
  ]);
  return { ok: true };
});

// Public profile lookup by handle (mobile contract expects /identity/public/:id)
app.get('/public/:handle', async (request, reply) => {
  const auth = getAuthUser(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const handle = (request.params as any).handle as string;
  const res = await pool.query(
    'select id, handle, generation, is_verified, display_name, bio, avatar_url, created_at from users where handle=$1 and deleted_at is null',
    [handle],
  );
  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'not found' };
  }
  return { user: res.rows[0] };
});

// Sessions list/revoke (mobile contract)
app.get('/sessions', async (request, reply) => {
  const auth = getAuthUser(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const okUser = await pool.query('select 1 from users where id=$1 and deleted_at is null', [auth.sub]);
  if (!okUser.rowCount) {
    reply.status(403);
    return { error: 'account_deleted' };
  }
  const rows = await pool.query(
    'select id, created_at, last_active_at, expires_at, device_fingerprint from sessions where user_id=$1 and revoked_at is null order by created_at desc limit 50',
    [auth.sub],
  );
  return {
    sessions: rows.rows.map((s: any) => ({
      id: s.id,
      device: s.device_fingerprint ? `Device ${String(s.device_fingerprint).slice(0, 6)}` : 'Session',
      created_at: s.created_at,
      last_active: s.last_active_at,
      current: auth.sid ? s.id === auth.sid : false,
    })),
  };
});

app.delete('/sessions/:id', async (request, reply) => {
  const auth = getAuthUser(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const okUser = await pool.query('select 1 from users where id=$1 and deleted_at is null', [auth.sub]);
  if (!okUser.rowCount) {
    reply.status(403);
    return { error: 'account_deleted' };
  }
  const id = (request.params as any).id as string;
  await pool.query('update sessions set revoked_at=now() where id=$1 and user_id=$2', [id, auth.sub]);
  return { ok: true };
});

// --- Account deletion (App Store requirement) ---
app.post('/account/delete', async (request, reply) => {
  const auth = getAuthUser(request);
  if (!auth) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const body = (request.body ?? {}) as { reason?: string };
  const reason = body.reason ? String(body.reason).slice(0, 280) : null;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  const existing = await pool.query('select handle, deleted_at, generation from users where id=$1', [auth.sub]);
  if (!existing.rowCount) {
    reply.status(404);
    return { error: 'not found' };
  }
  if (existing.rows[0].deleted_at) {
    return { ok: true, deleted: true };
  }

  const newPass = await hashValue(crypto.randomUUID());
  await pool.query('begin');
  try {
    await pool.query(
      'update users set deleted_at=now(), deleted_reason=$2, display_name=null, bio=null, avatar_url=null, is_verified=false, generation=null, password_hash=$3 where id=$1',
      [auth.sub, reason, newPass],
    );
    await pool.query('update sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [auth.sub]);
    await pool.query('commit');
  } catch (e) {
    await pool.query('rollback');
    throw e;
  }

  await appendEvent(
    'identity.account_deleted',
    { user_id: auth.sub, handle: existing.rows[0].handle, deleted_at: new Date().toISOString(), reason },
    auth.sub,
    existing.rows[0].generation as any,
    correlationId,
  );

  return { ok: true, deleted: true };
});

// Password reset stubs (until email/SMS provider is integrated)
app.post('/password/forgot', async (request, reply) => {
  const body = request.body as { contact?: string; handle?: string };
  if (!body.contact && !body.handle) {
    reply.status(400);
    return { error: 'contact or handle required' };
  }
  // For now: return a one-time token (not delivered) to allow flow testing.
  const token = (globalThis as any).crypto?.randomUUID?.() ?? `${Date.now()}`;
  return { ok: true, token };
});

app.post('/password/reset', async (request, reply) => {
  const body = request.body as { token?: string; password?: string };
  if (!body.token || !body.password) {
    reply.status(400);
    return { error: 'token and password required' };
  }
  // Stub: accept but do not mutate without token linkage.
  return { ok: true };
});

app.get('/users/:id', async (request, reply) => {
  const user = getAuthUser(request);
  if (!user) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const params = request.params as any;
  if (user.sub !== params['id']) {
    reply.status(403);
    return { error: 'forbidden' };
  }
  const res = await pool.query(
    'select id, handle, generation, is_verified, created_at from users where id=$1',
    [user.sub],
  );
  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'not found' };
  }
  return { user: res.rows[0] };
});

app.get('/admin/users/:id', async (request, reply) => {
  const role = request.headers['x-ops-role'];
  if (!role) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const id = (request.params as any)['id'];
  const res = await pool.query(
    'select id, handle, generation, is_verified, created_at from users where id=$1',
    [id],
  );
  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'not found' };
  }
  return { user: res.rows[0] };
});

app.get('/events', async (request, reply) => {
  const role = request.headers['x-ops-role'];
  if (!role) {
    reply.status(401);
    return { error: 'ops role required' };
  }
  const query = request.query as any;
  const since = query['since'] as string | undefined;
  const limit = Number(query['limit'] ?? 50);
  const rows = await pool.query(
    'select * from events where ($1::timestamptz is null or occurred_at > $1) order by occurred_at desc limit $2',
    [since ? new Date(since) : null, limit],
  );
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
  const port = Number(process.env.PORT ?? 4001);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`identity running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start identity');
  process.exit(1);
});

