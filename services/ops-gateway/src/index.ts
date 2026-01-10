import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { compareHash, ensureCorrelationId, getPool, rateLimitMiddleware } from '@platform/shared';
import { Role, isAllowed } from '@platform/security';
import { buildEvent, publishEvent } from '@platform/events';
import crypto from 'crypto';

const app = Fastify({ logger: true });
const pool = getPool('ops');
const identityPool = getPool('identity');
const safetyPool = getPool('safety');
const discoursePool = getPool('discourse');
const purgePool = getPool('purge');
const credPool = getPool('cred');
const trustgraphPool = getPool('trustgraph');

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

const normalizeRouteForFingerprint = (route: string) => {
  const raw = String(route ?? '').split('?')[0];
  return raw
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
    .replace(/\/\d{2,}/g, '/:num')
    .slice(0, 160);
};

app.setErrorHandler(async (err, request, reply) => {
  try {
    const correlationId = String(request.headers['x-correlation-id'] ?? '');
    const routeKey = normalizeRouteForFingerprint(String(request.url));
    const msg = String((err as any)?.message ?? (err as any)?.code ?? 'unhandled_error').slice(0, 200);
    const fp = `ops-gateway:${request.method}:${routeKey}:${msg}`.slice(0, 180);
    await pool.query(
      `insert into ops_errors (fingerprint, service, route, status, message, sample_correlation_id, count, first_seen_at, last_seen_at, meta)
       values ($1,$2,$3,$4,$5,$6,1,now(),now(),$7)
       on conflict (fingerprint)
       do update set count=ops_errors.count+1, last_seen_at=now(), message=excluded.message, sample_correlation_id=excluded.sample_correlation_id, meta=excluded.meta`,
      [fp, 'ops-gateway', routeKey, 500, msg, correlationId || null, JSON.stringify({ source: 'ops_gateway_error_handler' })],
    );
  } catch {
    // ignore
  }
  reply.status(500).send({ error: 'internal_error' });
});

app.register(swagger, { openapi: { info: { title: 'Ops Gateway', version: '0.0.1' } } });
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));

type OpsPrincipal = { role: Role; user: string };

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = cookieHeader ?? '';
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(v);
  }
  return out;
}

const getPrincipal = (request: any): OpsPrincipal | null => {
  // Legacy dev header auth (kept behind env toggle).
  if (String(process.env.OPS_ALLOW_DEV_HEADERS ?? 'false') !== 'true') return null;
  const roleRaw = String(request.headers['x-ops-role'] ?? '').trim();
  const user = String(request.headers['x-ops-user'] ?? 'local-dev').trim() || 'local-dev';
  const role = (Object.values(Role) as string[]).includes(roleRaw) ? (roleRaw as Role) : null;
  return role ? { role, user } : null;
};

const getInternalKey = () => String(process.env.OPS_INTERNAL_KEY ?? 'dev_internal');

const getInternalPrincipal = (request: any): OpsPrincipal | null => {
  // Internal service-to-service calls (e.g. ops-agents executing approved tools)
  if (String(request.headers['x-internal-call'] ?? '') !== 'true') return null;
  if (String(request.headers['x-internal-key'] ?? '') !== getInternalKey()) return null;
  const user = String(request.headers['x-ops-user'] ?? 'ops-agent').trim() || 'ops-agent';
  return { role: Role.CoreOps, user };
};

const getSessionPrincipal = async (request: any): Promise<OpsPrincipal | null> => {
  const cookies = parseCookies(String(request.headers.cookie ?? ''));
  const sid = cookies['ops_session'];
  if (!sid) return null;
  const row = await pool.query(
    `select u.email, u.role
     from ops_sessions s join ops_users u on u.id=s.user_id
     where s.id=$1 and s.revoked_at is null and s.expires_at > now()
     limit 1`,
    [sid],
  );
  if (!row.rowCount) return null;
  const roleRaw = String(row.rows[0].role ?? '');
  const role = (Object.values(Role) as string[]).includes(roleRaw) ? (roleRaw as Role) : null;
  if (!role) return null;
  return { role, user: String(row.rows[0].email ?? 'ops') };
};

async function audit(args: {
  correlationId: string;
  principal: OpsPrincipal | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  reason?: string | null;
  meta?: Record<string, unknown>;
}) {
  await pool.query(
    `insert into ops_audit_log (correlation_id, ops_role, ops_user, action, target_type, target_id, reason, meta)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      args.correlationId,
      args.principal?.role ?? null,
      args.principal?.user ?? null,
      args.action,
      args.target_type ?? null,
      args.target_id ?? null,
      args.reason ?? null,
      JSON.stringify(args.meta ?? {}),
    ],
  );
}

async function requireAccess(request: any, reply: any, resource: string, action: 'read' | 'write' | 'execute') {
  const principal = getInternalPrincipal(request) ?? (await getSessionPrincipal(request)) ?? getPrincipal(request);
  if (!principal) {
    reply.status(401).send({ error: 'ops_unauthorized' });
    return null;
  }
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const allowed = isAllowed({
    actorId: principal.user,
    actorGeneration: 'millennial',
    correlationId,
    role: principal.role,
    resource,
    action,
  } as any);
  if (!allowed) {
    reply.status(403).send({ error: 'forbidden' });
    return null;
  }
  return principal;
}

async function requireInternalTool(request: any, reply: any) {
  const principal = getInternalPrincipal(request);
  if (!principal) {
    reply.status(401).send({ error: 'internal_unauthorized' });
    return null;
  }
  return principal;
}

// ---- Tool implementations (single write path for automation) ----
async function toolApplyFriction(args: {
  target_type: string;
  target_id: string;
  friction_type: string;
  expires_in_sec?: number;
  reason?: string;
  approval_id: string;
  correlationId: string;
}) {
  const expires = new Date(Date.now() + Math.max(60, args.expires_in_sec ?? 1800) * 1000);
  const row = await safetyPool.query(
    `insert into safety_friction (target_type, target_id, friction_type, expires_at, algo_version, inputs_window, computed_at)
     values ($1,$2,$3,$4,$5,$6,now()) returning *`,
    [args.target_type, args.target_id, args.friction_type, expires.toISOString(), 'ops_tool_v1', `approval:${args.approval_id}`],
  );
  return row.rows[0];
}

async function toolRestrictUser(args: {
  user_id: string;
  reason: string;
  expires_in_sec?: number;
  approval_id: string;
}) {
  const expires = new Date(Date.now() + Math.max(60, args.expires_in_sec ?? 24 * 3600) * 1000);
  const row = await safetyPool.query('insert into safety_restrictions (user_id, reason, expires_at) values ($1,$2,$3) returning *', [
    args.user_id,
    args.reason,
    expires.toISOString(),
  ]);
  return row.rows[0];
}

async function toolLiftRestriction(args: { user_id: string; reason?: string; approval_id: string }) {
  // For v0, "lifting" means expire all active restrictions for the user.
  const res = await safetyPool.query(
    `update safety_restrictions
     set expires_at = now()
     where user_id=$1 and expires_at > now()
     returning *`,
    [args.user_id],
  );
  for (const r of res.rows) {
    await safetyPool.query(
      'insert into safety_audit (target_type, target_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5,$6)',
      ['user', r.user_id, 'restriction_lifted', null, null, { approval_id: args.approval_id, reason: args.reason ?? null }],
    );
  }
  return { lifted: res.rowCount ?? 0 };
}

async function toolRevokeFriction(args: { friction_id: string; reason?: string; approval_id: string }) {
  const row = await safetyPool.query(
    `update safety_friction
     set status='revoked', expires_at=now(), updated_at=now()
     where id=$1
     returning *`,
    [args.friction_id],
  );
  if (row.rowCount) {
    await safetyPool.query(
      'insert into safety_audit (target_type, target_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5,$6)',
      ['friction', args.friction_id, 'friction_revoked', null, null, { approval_id: args.approval_id, reason: args.reason ?? null }],
    );
  }
  return row.rows[0] ?? null;
}

async function toolRemoveEntry(args: { entry_id: string }) {
  await discoursePool.query('update entries set deleted_at=now() where id=$1', [args.entry_id]);
  return { ok: true };
}

async function toolRestoreEntry(args: { entry_id: string }) {
  const row = await discoursePool.query('update entries set deleted_at=null where id=$1 returning id, deleted_at', [args.entry_id]);
  return { ok: true, restored: Boolean(row.rowCount) };
}

// --- Tools API (internal, approval-gated) ---
app.post('/ops/tools/safety/apply-friction', async (request, reply) => {
  const principal = await requireInternalTool(request, reply);
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const body = (request.body ?? {}) as {
    approval_id?: string;
    target_type?: string;
    target_id?: string;
    friction_type?: string;
    expires_in_sec?: number;
    reason?: string;
  };
  if (!body.approval_id || !body.target_type || !body.target_id || !body.friction_type) {
    reply.status(400);
    return { error: 'approval_id, target_type, target_id, friction_type required' };
  }
  await audit({
    correlationId,
    principal,
    action: 'tools.safety.apply_friction',
    target_type: body.target_type,
    target_id: body.target_id,
    reason: body.reason ?? null,
    meta: { approval_id: body.approval_id, friction_type: body.friction_type, expires_in_sec: body.expires_in_sec },
  });
  const friction = await toolApplyFriction({
    approval_id: body.approval_id,
    target_type: body.target_type,
    target_id: body.target_id,
    friction_type: body.friction_type,
    expires_in_sec: body.expires_in_sec,
    reason: body.reason,
    correlationId,
  });
  return { friction };
});

app.post('/ops/tools/safety/restrict-user', async (request, reply) => {
  const principal = await requireInternalTool(request, reply);
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const body = (request.body ?? {}) as { approval_id?: string; user_id?: string; reason?: string; expires_in_sec?: number };
  if (!body.approval_id || !body.user_id || !body.reason) {
    reply.status(400);
    return { error: 'approval_id, user_id, reason required' };
  }
  await audit({
    correlationId,
    principal,
    action: 'tools.safety.restrict_user',
    target_type: 'user',
    target_id: body.user_id,
    reason: body.reason,
    meta: { approval_id: body.approval_id, expires_in_sec: body.expires_in_sec },
  });
  const restriction = await toolRestrictUser({
    approval_id: body.approval_id,
    user_id: body.user_id,
    reason: body.reason,
    expires_in_sec: body.expires_in_sec,
  });
  return { restriction };
});

app.post('/ops/tools/safety/lift-restriction', async (request, reply) => {
  const principal = await requireInternalTool(request, reply);
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const body = (request.body ?? {}) as { approval_id?: string; user_id?: string; reason?: string };
  if (!body.approval_id || !body.user_id) {
    reply.status(400);
    return { error: 'approval_id, user_id required' };
  }
  await audit({
    correlationId,
    principal,
    action: 'tools.safety.lift_restriction',
    target_type: 'user',
    target_id: body.user_id,
    reason: body.reason ?? null,
    meta: { approval_id: body.approval_id },
  });
  const out = await toolLiftRestriction({ approval_id: body.approval_id, user_id: body.user_id, reason: body.reason });
  return out;
});

app.post('/ops/tools/safety/revoke-friction', async (request, reply) => {
  const principal = await requireInternalTool(request, reply);
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const body = (request.body ?? {}) as { approval_id?: string; friction_id?: string; reason?: string };
  if (!body.approval_id || !body.friction_id) {
    reply.status(400);
    return { error: 'approval_id, friction_id required' };
  }
  await audit({
    correlationId,
    principal,
    action: 'tools.safety.revoke_friction',
    target_type: 'friction',
    target_id: body.friction_id,
    reason: body.reason ?? null,
    meta: { approval_id: body.approval_id },
  });
  const friction = await toolRevokeFriction({ approval_id: body.approval_id, friction_id: body.friction_id, reason: body.reason });
  return { friction };
});

app.post('/ops/tools/discourse/remove-entry', async (request, reply) => {
  const principal = await requireInternalTool(request, reply);
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const body = (request.body ?? {}) as { approval_id?: string; entry_id?: string; reason?: string };
  if (!body.approval_id || !body.entry_id) {
    reply.status(400);
    return { error: 'approval_id, entry_id required' };
  }
  await audit({
    correlationId,
    principal,
    action: 'tools.discourse.remove_entry',
    target_type: 'entry',
    target_id: body.entry_id,
    reason: body.reason ?? null,
    meta: { approval_id: body.approval_id },
  });
  const res = await toolRemoveEntry({ entry_id: body.entry_id });
  return res;
});

app.post('/ops/tools/discourse/restore-entry', async (request, reply) => {
  const principal = await requireInternalTool(request, reply);
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const body = (request.body ?? {}) as { approval_id?: string; entry_id?: string; reason?: string };
  if (!body.approval_id || !body.entry_id) {
    reply.status(400);
    return { error: 'approval_id, entry_id required' };
  }
  await audit({
    correlationId,
    principal,
    action: 'tools.discourse.restore_entry',
    target_type: 'entry',
    target_id: body.entry_id,
    reason: body.reason ?? null,
    meta: { approval_id: body.approval_id },
  });
  const res = await toolRestoreEntry({ entry_id: body.entry_id });
  return res;
});

// --- Auth (v0) ---
app.get('/ops/auth/me', async (request, _reply) => {
  const principal = (await getSessionPrincipal(request)) ?? getPrincipal(request);
  await audit({
    correlationId: String(request.headers['x-correlation-id'] ?? ''),
    principal,
    action: 'ops.auth.me',
  });
  if (!principal) return { user: null };
  return { user: { id: principal.user, email: principal.user, role: principal.role } };
});

app.post('/ops/auth/login', async (request, reply) => {
  const body = (request.body ?? {}) as { email?: string; password?: string };
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const ip = String((request.headers['x-forwarded-for'] as string | undefined) ?? request.ip ?? 'unknown')
    .split(',')[0]
    .trim();
  await rateLimitMiddleware({
    key: `ops_login:${ip}:${email || 'unknown'}`,
    limit: 20,
    windowSec: 60,
    cooldownSec: 60 * 10,
    cooldownThreshold: 40,
  })(request, reply);
  if ((reply as any).sent) return reply;
  if (!email || !password) {
    reply.status(400);
    return { error: 'email and password required' };
  }
  const u = await pool.query('select id, email, role, password_hash from ops_users where email=$1', [email]);
  if (!u.rowCount) {
    reply.status(401);
    return { error: 'invalid_credentials' };
  }
  const ok = await compareHash(password, u.rows[0].password_hash);
  if (!ok) {
    reply.status(401);
    return { error: 'invalid_credentials' };
  }
  const expiresMs = Number(process.env.OPS_SESSION_TTL_MS ?? 1000 * 60 * 60 * 12);
  const expiresAt = new Date(Date.now() + expiresMs);
  const sid = crypto.randomUUID();
  await pool.query('insert into ops_sessions (id, user_id, expires_at) values ($1,$2,$3)', [sid, u.rows[0].id, expiresAt.toISOString()]);
  reply.header(
    'set-cookie',
    `ops_session=${encodeURIComponent(sid)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(expiresMs / 1000)}`,
  );
  const principal = { role: u.rows[0].role as any, user: u.rows[0].email as string } as OpsPrincipal;
  await audit({
    correlationId: String(request.headers['x-correlation-id'] ?? ''),
    principal,
    action: 'ops.auth.login',
  });
  return { ok: true, user: { id: u.rows[0].id, email: u.rows[0].email, role: u.rows[0].role } };
});

app.post('/ops/auth/logout', async (request, reply) => {
  const principal = await getSessionPrincipal(request);
  const cookies = parseCookies(String(request.headers.cookie ?? ''));
  const sid = cookies['ops_session'];
  if (sid) {
    await pool.query('update ops_sessions set revoked_at=now() where id=$1', [sid]);
  }
  reply.header('set-cookie', `ops_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  await audit({
    correlationId: String(request.headers['x-correlation-id'] ?? ''),
    principal,
    action: 'ops.auth.logout',
  });
  return { ok: true };
});

// --- Users ---
app.get('/ops/users/search', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_users', 'read');
  if (!principal) return reply;
  const q = String((request.query as any)?.q ?? '').trim();
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'users.search', target_type: 'query', target_id: q, meta: { q } });
  if (!q) return { users: [] };
  const like = `%${q}%`;
  const rows = await identityPool.query(
    `select id, handle, display_name, created_at, deleted_at
     from users
     where deleted_at is null
       and (handle ilike $1 or display_name ilike $1)
     order by created_at desc
     limit 50`,
    [like],
  );
  return { users: rows.rows };
});

app.get('/ops/users/:id', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_users', 'read');
  if (!principal) return reply;
  const id = String((request.params as any).id);
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'users.detail', target_type: 'user', target_id: id });

  const user = await identityPool.query(
    `select id, handle, display_name, bio, avatar_url, generation, is_verified, created_at, deleted_at
     from users where id=$1`,
    [id],
  );
  if (!user.rowCount) {
    reply.status(404);
    return { error: 'not_found' };
  }

  const sessions = await identityPool.query(
    `select id, device_fingerprint, created_at, last_active_at, revoked_at, expires_at
     from sessions where user_id=$1 order by last_active_at desc limit 50`,
    [id],
  );

  const restrictions = await safetyPool.query(
    `select id, reason, expires_at, created_at
     from safety_restrictions where user_id=$1 and expires_at > now()
     order by expires_at asc`,
    [id],
  );
  const frictions = await safetyPool.query(
    `select id, friction_type, expires_at, status, created_at, algo_version
     from safety_friction where target_id=$1 and expires_at > now()
     order by expires_at asc`,
    [id],
  );

  const recentEntries = await discoursePool.query(
    `select id, topic, assumption_type, left(body, 180) as body_preview, created_at
     from entries where user_id=$1 and deleted_at is null
     order by created_at desc
     limit 20`,
    [id],
  );

  return {
    user: user.rows[0],
    sessions: sessions.rows,
    safety: { restrictions: restrictions.rows, frictions: frictions.rows },
    recent: { entries: recentEntries.rows },
  };
});

// --- Audit log ---
app.get('/ops/audit', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_audit', 'read');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'audit.list' });
  const rows = await pool.query('select * from ops_audit_log order by occurred_at desc limit 200');
  return { entries: rows.rows };
});

// --- Config (placeholder) ---
app.get('/ops/config', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_config', 'read');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'config.get' });
  return { environment: process.env.NODE_ENV ?? 'development', flags: { example: true } };
});

// --- Ops diagnostics (local-first) ---
app.get('/ops/purge/surge-recommendations', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_purge', 'read');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'purge.surge.list' });
  const rows = await purgePool.query('select * from purge_surge_recommendations order by created_at desc limit 50');
  return { recommendations: rows.rows };
});

app.get('/ops/integrity/triage-suggestions', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_integrity', 'read');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'integrity.triage_suggestions.list' });
  const rows = await safetyPool.query('select * from triage_suggestions order by created_at desc limit 100');
  return { suggestions: rows.rows };
});

app.get('/ops/trust/user/:id', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_trust', 'read');
  if (!principal) return reply;
  const userId = String((request.params as any).id);
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'trust.user.detail', target_type: 'user', target_id: userId });
  const nodes = await trustgraphPool.query('select * from trust_nodes where user_id=$1 order by updated_at desc', [userId]);
  const history = await trustgraphPool.query(
    'select metric, value, created_at from trust_history where user_id=$1 order by created_at desc limit 100',
    [userId],
  );
  return { user_id: userId, nodes: nodes.rows, history: history.rows };
});

app.get('/ops/cred/ledger', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_cred', 'read');
  if (!principal) return reply;
  const userId = String((request.query as any)?.user_id ?? '').trim();
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'cred.ledger.list', target_type: 'user', target_id: userId || '—' });
  if (!userId) return { ledger: [] };
  const rows = await credPool.query('select * from cred_ledger where user_id=$1 order by created_at desc limit 200', [userId]);
  return { ledger: rows.rows };
});

app.get('/ops/system/materializer/status', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_system', 'read');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'system.materializer.status' });
  const res = await discoursePool.query('select max(created_at) as last_item from timeline_items');
  return { ok: true, last_item: res.rows[0]?.last_item ?? null };
});

// --- Observability (v0) ---
app.get('/ops/observability/health', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_config', 'read');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'observability.health' });

  const targets: Record<string, string> = {
    gateway: process.env.GATEWAY_URL ?? 'http://localhost:4000',
    identity: process.env.IDENTITY_URL ?? 'http://localhost:4001',
    discourse: process.env.DISCOURSE_URL ?? 'http://localhost:4002',
    purge: process.env.PURGE_URL ?? 'http://localhost:4003',
    cred: process.env.CRED_URL ?? 'http://localhost:4004',
    endorse: process.env.ENDORSE_URL ?? 'http://localhost:4005',
    trustgraph: process.env.TRUST_URL ?? 'http://localhost:4007',
    safety: process.env.SAFETY_URL ?? 'http://localhost:4008',
    notifications: process.env.NOTIFICATIONS_URL ?? 'http://localhost:4009',
    search: process.env.SEARCH_URL ?? 'http://localhost:4010',
    messaging: process.env.MESSAGING_URL ?? 'http://localhost:4011',
    lists: process.env.LISTS_URL ?? 'http://localhost:4012',
  };

  const out: any = {};
  await Promise.all(
    Object.entries(targets).map(async ([k, base]) => {
      try {
        const r = await fetch(`${base}/readyz`);
        out[k] = { ok: r.ok, status: r.status };
      } catch (e: any) {
        out[k] = { ok: false, error: e?.message ?? 'unreachable' };
      }
    }),
  );
  return out;
});

app.get('/ops/observability/error-inbox', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_config', 'read');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'observability.error_inbox' });
  const rows = await pool.query('select * from ops_errors order by last_seen_at desc limit 200');
  return { items: rows.rows };
});

app.post('/ops/observability/report-error', async (request, reply) => {
  const principal = await requireInternalTool(request, reply);
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const body = (request.body ?? {}) as {
    fingerprint?: string;
    service?: string;
    route?: string;
    status?: number;
    message?: string;
    meta?: Record<string, unknown>;
  };
  const fingerprint = String(body.fingerprint ?? '').slice(0, 200);
  if (!fingerprint) {
    reply.status(400);
    return { error: 'fingerprint required' };
  }
  const message = String(body.message ?? '').slice(0, 800);
  await pool.query(
    `insert into ops_errors (fingerprint, service, route, status, message, sample_correlation_id, count, first_seen_at, last_seen_at, meta)
     values ($1,$2,$3,$4,$5,$6,1,now(),now(),$7)
     on conflict (fingerprint)
     do update set
       count=ops_errors.count+1,
       last_seen_at=now(),
       service=excluded.service,
       route=excluded.route,
       status=excluded.status,
       message=excluded.message,
       sample_correlation_id=excluded.sample_correlation_id,
       meta=excluded.meta`,
    [
      fingerprint,
      body.service ?? null,
      body.route ?? null,
      typeof body.status === 'number' ? body.status : null,
      message || null,
      correlationId || null,
      JSON.stringify(body.meta ?? {}),
    ],
  );
  await audit({
    correlationId,
    principal,
    action: 'observability.report_error',
    target_type: 'error',
    target_id: fingerprint,
    meta: { service: body.service, route: body.route, status: body.status },
  });
  // Emit a lightweight event for ops-agents to react to (best-effort).
  try {
    const evt = buildEvent(
      'ops.error_raised',
      { fingerprint, service: body.service ?? null, route: body.route ?? null, status: body.status ?? null, message },
      { actorId: principal.user, correlationId },
    );
    await publishEvent('events.ops_agents.v1', evt);
  } catch {
    // ignore
  }
  return { ok: true };
});

// --- Moderation queue (v0: safety reports) ---
app.get('/ops/moderation/queue', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_moderation_queue', 'read');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'moderation.queue' });

  const rows = await safetyPool.query(
    `select id, reporter_id, target_type, target_id, reason, status, created_at
     from reports
     where status='open'
     order by created_at desc
     limit 100`,
  );
  return {
    items: rows.rows.map((r: any) => ({
      id: r.id,
      title: `${r.target_type}:${String(r.target_id).slice(0, 8)}`,
      reason: r.reason,
      status: r.status,
      target: { type: r.target_type, id: r.target_id },
      created_at: r.created_at,
    })),
  };
});

app.get('/ops/moderation/:id', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_moderation_queue', 'read');
  if (!principal) return reply;
  const id = String((request.params as any).id);
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'moderation.detail', target_type: 'report', target_id: id });

  const rep = await safetyPool.query('select * from reports where id=$1', [id]);
  if (!rep.rowCount) {
    reply.status(404);
    return { error: 'not_found' };
  }
  const report = rep.rows[0];

  // content snapshot (best-effort)
  let content: any = null;
  if (report.target_type === 'content' || report.target_type === 'entry') {
    const entry = await discoursePool.query(
      `select id, user_id, topic, assumption_type, body, created_at, deleted_at
       from entries where id=$1`,
      [report.target_id],
    );
    content = entry.rowCount ? entry.rows[0] : null;
  }

  // author + history (best-effort)
  let author: any = null;
  if (content?.user_id) {
    const u = await identityPool.query(
      `select id, handle, display_name, created_at, deleted_at
       from users where id=$1`,
      [content.user_id],
    );
    author = u.rowCount ? u.rows[0] : null;
  }

  // triage suggestion (integrity worker) (best-effort)
  let triage: any = null;
  try {
    const t = await safetyPool.query('select * from triage_suggestions where report_id=$1', [id]);
    triage = t.rowCount ? t.rows[0] : null;
  } catch {
    triage = null;
  }

  // current enforcement state (best-effort)
  let enforcement: any = { restrictions: [], frictions: [] };
  try {
    const userId = author?.id ?? content?.user_id ?? null;
    if (userId) {
      const restrictions = await safetyPool.query(
        `select * from safety_restrictions where user_id=$1 and expires_at > now() order by expires_at asc limit 50`,
        [userId],
      );
      enforcement.restrictions = restrictions.rows;
    }
    if (report.target_type === 'content' || report.target_type === 'entry') {
      const fr = await safetyPool.query(
        `select * from safety_friction where target_id=$1 and expires_at > now() order by expires_at asc limit 50`,
        [report.target_id],
      );
      enforcement.frictions = fr.rows;
    }
  } catch {
    enforcement = { restrictions: [], frictions: [] };
  }

  const priorReports = await safetyPool.query(
    `select count(*)::int as c
     from reports
     where target_type=$1 and target_id=$2`,
    [report.target_type, report.target_id],
  );

  const priorActions = await safetyPool.query(
    `select * from moderation_actions
     where target_type=$1 and target_id=$2
     order by created_at desc
     limit 25`,
    [report.target_type, report.target_id],
  );

  return {
    report,
    content,
    author,
    triage,
    enforcement,
    history: { prior_reports: priorReports.rows[0]?.c ?? 0, moderation_actions: priorActions.rows },
  };
});

app.post('/ops/moderation/:id/action', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_moderation_action', 'write');
  if (!principal) return reply;
  const id = String((request.params as any).id);
  const body = (request.body ?? {}) as { decision?: string; reason?: string; notes?: string; duration_hours?: number };
  const decision = String(body.decision ?? '').toLowerCase();
  const reason = String(body.reason ?? '').slice(0, 280);
  const notes = String(body.notes ?? '').slice(0, 2000);
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  if (!reason.trim()) {
    reply.status(400);
    return { error: 'reason required' };
  }
  await audit({
    correlationId,
    principal,
    action: 'moderation.action',
    target_type: 'report',
    target_id: id,
    reason,
    meta: { decision, notes },
  });

  const rep = await safetyPool.query('select * from reports where id=$1', [id]);
  if (!rep.rowCount) {
    reply.status(404);
    return { error: 'not_found' };
  }
  const report = rep.rows[0];

  // Record moderation action
  await safetyPool.query(
    `insert into moderation_actions (actor_ops_id, target_type, target_id, action, reason_code)
     values ($1,$2,$3,$4,$5)`,
    [principal.user, report.target_type, report.target_id, decision || 'unknown', reason || 'unspecified'],
  );

  if (decision === 'remove') {
    if (report.target_type === 'content' || report.target_type === 'entry') {
      await discoursePool.query('update entries set deleted_at=now() where id=$1', [report.target_id]);
    }
    await safetyPool.query("update reports set status='closed' where id=$1", [id]);
    return { ok: true, applied: 'remove' };
  }

  if (decision === 'restrict') {
    // User-level restriction (very simple v0)
    const hours = Number(body.duration_hours ?? 24);
    const expires = new Date(Date.now() + Math.max(1, hours) * 3600 * 1000);
    // If report target is content, restrict author; else restrict target_id if it looks like a user id.
    let userId = report.target_id;
    if (report.target_type === 'content' || report.target_type === 'entry') {
      const entry = await discoursePool.query('select user_id from entries where id=$1', [report.target_id]);
      if (entry.rowCount) userId = entry.rows[0].user_id;
    }
    await safetyPool.query('insert into safety_restrictions (user_id, reason, expires_at) values ($1,$2,$3)', [
      userId,
      reason || 'restricted',
      expires.toISOString(),
    ]);
    await safetyPool.query("update reports set status='closed' where id=$1", [id]);
    return { ok: true, applied: 'restrict', user_id: userId, expires_at: expires.toISOString() };
  }

  if (decision === 'allow') {
    await safetyPool.query("update reports set status='closed' where id=$1", [id]);
    return { ok: true, applied: 'allow' };
  }

  reply.status(400);
  return { error: 'unsupported_decision' };
});

// --- Safety (appeals + friction) ---
app.get('/ops/safety/appeals', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_safety', 'read');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'safety.appeals.list' });
  const rows = await safetyPool.query('select * from safety_appeals order by created_at desc limit 200');
  return { appeals: rows.rows };
});

app.post('/ops/safety/appeals/:id/resolve', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_safety', 'write');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const id = String((request.params as any).id);
  const body = (request.body ?? {}) as { resolution?: string; reason?: string };
  const resolution = String(body.resolution ?? 'resolved').slice(0, 200);
  const reason = String(body.reason ?? '').slice(0, 280);
  if (!reason.trim()) {
    reply.status(400);
    return { error: 'reason required' };
  }
  const row = await safetyPool.query(
    `update safety_appeals set status='resolved', resolution=$2, decided_at=now(), computed_at=now()
     where id=$1 returning *`,
    [id, resolution],
  );
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not_found' };
  }
  await safetyPool.query(
    'insert into safety_audit (target_type, target_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5,$6)',
    ['appeal', id, 'appeal_resolved', null, null, { resolution, reason, ops_user: principal.user }],
  );
  await audit({ correlationId, principal, action: 'safety.appeals.resolve', target_type: 'appeal', target_id: id, reason });
  return { appeal: row.rows[0] };
});

app.get('/ops/safety/friction', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_safety', 'read');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  await audit({ correlationId, principal, action: 'safety.friction.list' });
  const rows = await safetyPool.query('select * from safety_friction where expires_at > now() order by expires_at asc limit 200');
  return { friction: rows.rows };
});

app.post('/ops/safety/friction/:id/revoke', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_safety', 'write');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const id = String((request.params as any).id);
  const body = (request.body ?? {}) as { reason?: string };
  const reason = String(body.reason ?? '').slice(0, 280);
  if (!reason.trim()) {
    reply.status(400);
    return { error: 'reason required' };
  }
  const row = await safetyPool.query(
    `update safety_friction
     set status='revoked', expires_at=now(), updated_at=now()
     where id=$1 returning *`,
    [id],
  );
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not_found' };
  }
  await safetyPool.query(
    'insert into safety_audit (target_type, target_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5,$6)',
    ['friction', id, 'friction_revoked', null, null, { reason, ops_user: principal.user }],
  );
  await audit({ correlationId, principal, action: 'safety.friction.revoke', target_type: 'friction', target_id: id, reason });
  return { friction: row.rows[0] };
});

app.post('/ops/safety/friction/:id/clear', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_safety', 'write');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const id = String((request.params as any).id);
  const body = (request.body ?? {}) as { reason?: string };
  const reason = String(body.reason ?? '').slice(0, 280);
  if (!reason.trim()) {
    reply.status(400);
    return { error: 'reason required' };
  }
  const row = await safetyPool.query(
    `update safety_friction
     set status='cleared', expires_at=now(), computed_at=now(), updated_at=now()
     where id=$1 returning *`,
    [id],
  );
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not_found' };
  }
  await safetyPool.query(
    'insert into safety_audit (target_type, target_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5,$6)',
    ['friction', id, 'friction_cleared', null, null, { reason, ops_user: principal.user }],
  );
  await audit({ correlationId, principal, action: 'safety.friction.clear', target_type: 'friction', target_id: id, reason });
  return { friction: row.rows[0] };
});

app.post('/ops/safety/restrictions/lift', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_safety', 'write');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const body = (request.body ?? {}) as { user_id?: string; reason?: string };
  const userId = String(body.user_id ?? '').trim();
  const reason = String(body.reason ?? '').slice(0, 280);
  if (!userId) {
    reply.status(400);
    return { error: 'user_id required' };
  }
  if (!reason.trim()) {
    reply.status(400);
    return { error: 'reason required' };
  }
  const res = await safetyPool.query(
    `update safety_restrictions
     set expires_at = now()
     where user_id=$1 and expires_at > now()
     returning *`,
    [userId],
  );
  for (const r of res.rows) {
    await safetyPool.query(
      'insert into safety_audit (target_type, target_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5,$6)',
      ['user', r.user_id, 'restriction_lifted', null, null, { reason, ops_user: principal.user, restriction_id: r.id }],
    );
  }
  await audit({ correlationId, principal, action: 'safety.restrictions.lift', target_type: 'user', target_id: userId, reason });
  return { ok: true, lifted: res.rowCount ?? 0, restrictions: res.rows };
});

app.post('/ops/safety/restrictions/:id/lift', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_safety', 'write');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const id = String((request.params as any).id);
  const body = (request.body ?? {}) as { reason?: string };
  const reason = String(body.reason ?? '').slice(0, 280);
  if (!reason.trim()) {
    reply.status(400);
    return { error: 'reason required' };
  }
  const row = await safetyPool.query(
    `update safety_restrictions
     set expires_at=now()
     where id=$1 returning *`,
    [id],
  );
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not_found' };
  }
  await safetyPool.query(
    'insert into safety_audit (target_type, target_id, action, actor_id, actor_generation, detail) values ($1,$2,$3,$4,$5,$6)',
    ['user', row.rows[0].user_id, 'restriction_lifted', null, null, { reason, ops_user: principal.user, restriction_id: id }],
  );
  await audit({ correlationId, principal, action: 'safety.restrictions.lift_one', target_type: 'restriction', target_id: id, reason });
  return { restriction: row.rows[0] };
});

app.post('/ops/discourse/entries/:id/restore', async (request, reply) => {
  const principal = await requireAccess(request, reply, 'ops_moderation_queue', 'write');
  if (!principal) return reply;
  const correlationId = String(request.headers['x-correlation-id'] ?? '');
  const id = String((request.params as any).id);
  const body = (request.body ?? {}) as { reason?: string };
  const reason = String(body.reason ?? '').slice(0, 280);
  if (!reason.trim()) {
    reply.status(400);
    return { error: 'reason required' };
  }
  const row = await discoursePool.query('update entries set deleted_at=null where id=$1 returning id, deleted_at', [id]);
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not_found' };
  }
  await audit({ correlationId, principal, action: 'discourse.entry.restore', target_type: 'entry', target_id: id, reason });
  return { ok: true, entry: row.rows[0] };
});

const start = async () => {
  const port = Number(process.env.PORT ?? 4013);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`ops-gateway running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start ops-gateway');
  process.exit(1);
});


