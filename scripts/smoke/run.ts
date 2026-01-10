/* eslint-disable no-console */
import crypto from 'crypto';
import { execSync } from 'child_process';

type Result = { name: string; ok: boolean; detail?: string; correlationId?: string };

const env = (key: string, fallback: string) => process.env[key] || fallback;

const IDENTITY_URL = env('IDENTITY_URL', 'http://localhost:4001');
const DISCOURSE_URL = env('DISCOURSE_URL', 'http://localhost:4002');
const PURGE_URL = env('PURGE_URL', 'http://localhost:4003');
const CRED_URL = env('CRED_URL', 'http://localhost:4004');
const ENDORSE_URL = env('ENDORSE_URL', 'http://localhost:4005');
const SAFETY_URL = env('SAFETY_URL', 'http://localhost:4008');
const TRUST_URL = env('TRUST_URL', 'http://localhost:4007');
const GATEWAY_URL = env('GATEWAY_URL', 'http://localhost:4000');
const OPS_GATEWAY_URL = env('OPS_GATEWAY_URL', 'http://localhost:4013');
const OPS_AGENTS_URL = env('OPS_AGENTS_URL', 'http://localhost:4014');

const OPS_ROLE = 'core_ops';

const rand = () => crypto.randomUUID();

type ReqOpts = {
  token?: string;
  body?: unknown;
  opsRole?: string;
  idempotencyKey?: string;
  method?: string;
};

const request = async (url: string, opts: ReqOpts = {}) => {
  const correlationId = rand();
  const headers: Record<string, string> = {
    'x-correlation-id': correlationId,
    'content-type': 'application/json',
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.opsRole) headers['x-ops-role'] = opts.opsRole;
  if (opts.idempotencyKey) headers['x-idempotency-key'] = opts.idempotencyKey;
  const res = await fetch(url, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { res, json, correlationId };
};

const results: Result[] = [];
const pass = (name: string, detail?: string, correlationId?: string) =>
  results.push({ name, ok: true, detail, correlationId });
const fail = (name: string, detail?: string, correlationId?: string) =>
  results.push({ name, ok: false, detail, correlationId });

const assert = (cond: boolean, name: string, detail?: string, correlationId?: string) => {
  if (cond) pass(name, detail, correlationId);
  else fail(name, detail, correlationId);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const serviceHealth = [
  { name: 'identity', url: `${IDENTITY_URL}/readyz` },
  { name: 'cred', url: `${CRED_URL}/readyz` },
  { name: 'discourse', url: `${DISCOURSE_URL}/readyz` },
  { name: 'purge', url: `${PURGE_URL}/readyz` },
  { name: 'endorse', url: `${ENDORSE_URL}/readyz` },
  { name: 'safety', url: `${SAFETY_URL}/readyz` },
  { name: 'trustgraph', url: `${TRUST_URL}/readyz` },
  { name: 'gateway', url: `${GATEWAY_URL}/readyz` },
  { name: 'ops-gateway', url: `${OPS_GATEWAY_URL}/readyz` },
  { name: 'ops-agents', url: `${OPS_AGENTS_URL}/readyz` },
];

const isHealthy = async (url: string) => {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
};

const ensureCoreStack = async () => {
  let allHealthy = true;
  for (const svc of serviceHealth) {
    if (!(await isHealthy(svc.url))) {
      allHealthy = false;
      break;
    }
  }
  if (allHealthy) {
    console.log('Core services already healthy; skipping core:up.');
    return;
  }
  console.log('Starting core stack via pnpm core:up ...');
  execSync('pnpm core:up', { stdio: 'inherit' });
};

const main = async () => {
  await ensureCoreStack();

  // Reset purge windows to ensure inactive start; assert success
  const reset = await request(`${PURGE_URL}/purge/reset`, { opsRole: OPS_ROLE, method: 'POST', body: {} });
  const resetDetail = typeof reset.json === 'string' ? reset.json : JSON.stringify(reset.json);
  assert(reset.res.ok, 'Purge reset', `status ${reset.res.status} body ${resetDetail}`, reset.correlationId);

  const userA = `smokeA_${Date.now()}`;
  const userB = `smokeB_${Date.now()}`;
  const password = 'Password123!';

  // Register A
  let r = await request(`${IDENTITY_URL}/auth/register`, {
    body: { handle: userA, password },
    idempotencyKey: rand(),
  });
  assert(r.res.ok, 'A) register A', `status ${r.res.status}`, r.correlationId);

  // Register B
  r = await request(`${IDENTITY_URL}/auth/register`, {
    body: { handle: userB, password },
    idempotencyKey: rand(),
  });
  assert(r.res.ok, 'A) register B', `status ${r.res.status}`, r.correlationId);

  // Login A
  r = await request(`${IDENTITY_URL}/auth/login`, {
    body: { handle: userA, password },
  });
  const tokenA = r.json?.access_token as string | undefined;
  assert(!!tokenA, 'A) login A', undefined, r.correlationId);

  // Login B
  r = await request(`${IDENTITY_URL}/auth/login`, {
    body: { handle: userB, password },
  });
  const tokenB = r.json?.access_token as string | undefined;
  assert(!!tokenB, 'A) login B', undefined, r.correlationId);

  // Verify ageband
  r = await request(`${IDENTITY_URL}/verify/ageband`, {
    token: tokenA,
    body: { generation: 'millennial' },
  });
  assert(r.res.ok, 'B) verify A', `status ${r.res.status}`, r.correlationId);
  r = await request(`${IDENTITY_URL}/verify/ageband`, {
    token: tokenB,
    body: { generation: 'genx' },
  });
  assert(r.res.ok, 'B) verify B', `status ${r.res.status}`, r.correlationId);

  // Refresh tokens after verification
  r = await request(`${IDENTITY_URL}/auth/login`, {
    body: { handle: userA, password },
  });
  const tokenA2 = r.json?.access_token as string | undefined;
  assert(!!tokenA2, 'B) relogin A after verify', undefined, r.correlationId);
  r = await request(`${IDENTITY_URL}/auth/login`, {
    body: { handle: userB, password },
  });
  const tokenB2 = r.json?.access_token as string | undefined;
  assert(!!tokenB2, 'B) relogin B after verify', undefined, r.correlationId);

  // Me check
  r = await request(`${IDENTITY_URL}/me`, { token: tokenA2 });
  assert(r.json?.user?.is_verified === true, 'B) me verified A', undefined, r.correlationId);

  // Missing assumption
  r = await request(`${DISCOURSE_URL}/entries`, { token: tokenA2, body: { content: 'hello' } });
  assert(r.res.status >= 400, 'C) entry missing assumption rejected', `status ${r.res.status}`, r.correlationId);

  // Balances before
  const balBeforeA = await request(`${CRED_URL}/cred/balances`, { token: tokenA2 });
  const claimsBefore = balBeforeA.json?.balance?.claims_remaining ?? 0;

  // Create entry with idempotency
  const idemKey = rand();
  r = await request(`${DISCOURSE_URL}/entries`, {
    token: tokenA2,
    body: { assumption_type: 'lived_experience', content: 'smoke entry' },
    idempotencyKey: idemKey,
  });
  assert(r.res.ok, 'D) entry created', `status ${r.res.status}`, r.correlationId);
  const entryId = r.json?.entry?.id;

  // Same idempotency again
  const r2 = await request(`${DISCOURSE_URL}/entries`, {
    token: tokenA2,
    body: { assumption_type: 'lived_experience', content: 'smoke entry' },
    idempotencyKey: idemKey,
  });
  assert(r2.res.ok, 'D) idempotent entry no double spend', `status ${r2.res.status}`, r2.correlationId);

  const balAfterA = await request(`${CRED_URL}/cred/balances`, { token: tokenA2 });
  const claimsAfter = balAfterA.json?.balance?.claims_remaining ?? 0;
  assert(
    claimsBefore - claimsAfter === 1,
    'D) cred spent once',
    `before ${claimsBefore}, after ${claimsAfter}`,
    balAfterA.correlationId,
  );

  // Feed inactive: userB should not see entry
  const feedB = await request(`${DISCOURSE_URL}/feed`, { token: tokenB2 });
  const feedHasEntry = (feedB.json?.feed || []).some((e: any) => e.id === entryId);
  assert(!feedHasEntry, 'E) gen-only feed blocks cross-gen', undefined, feedB.correlationId);
  assert(feedB.json?.materialized === true, 'Materialized feed flag', undefined, feedB.correlationId);

  // Cross-gen reply blocked
  const replyBlocked = await request(`${DISCOURSE_URL}/entries/${entryId}/reply`, {
    token: tokenB2,
    body: { content: 'hi' },
  });
  assert(replyBlocked.res.status === 403, 'F) cross-gen reply blocked', `status ${replyBlocked.res.status}`, replyBlocked.correlationId);

  // Media upload (local): upload-url -> upload base64 -> finalize -> attach to entry
  const tinyPngB64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X7g3UAAAAASUVORK5CYII=';
  const plan = await request(`${DISCOURSE_URL}/media/upload-url`, {
    token: tokenA2,
    body: { type: 'image', content_type: 'image/png', byte_size: 68, filename: 'smoke.png' },
  });
  const uploadId = plan.json?.upload?.id as string | undefined;
  assert(!!uploadId, 'J) media upload plan', JSON.stringify(plan.json), plan.correlationId);
  const upload = await request(`${DISCOURSE_URL}/media/upload`, {
    token: tokenA2,
    body: { id: uploadId, filename: 'smoke.png', content_type: 'image/png', data_base64: tinyPngB64 },
  });
  const publicUrl = upload.json?.media?.public_url as string | undefined;
  assert(!!publicUrl, 'J) media upload', JSON.stringify(upload.json), upload.correlationId);
  const fin = await request(`${DISCOURSE_URL}/media/finalize`, { token: tokenA2, body: { id: uploadId } });
  assert(fin.res.ok, 'J) media finalize', JSON.stringify(fin.json), fin.correlationId);
  const entryWithMedia = await request(`${DISCOURSE_URL}/entries`, {
    token: tokenA2,
    body: { assumption_type: 'lived_experience', content: 'smoke entry w/ media', media: [{ url: publicUrl, type: 'image' }] },
    idempotencyKey: rand(),
  });
  assert(entryWithMedia.res.ok, 'J) entry w/ media created', `status ${entryWithMedia.res.status}`, entryWithMedia.correlationId);

  // Ops gateway cookie auth (seeded admin) minimal check
  const login = await fetch(`${OPS_GATEWAY_URL}/ops/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-correlation-id': rand() },
    body: JSON.stringify({ email: 'admin@example.com', password: 'admin' }),
  });
  const setCookie = login.headers.get('set-cookie') ?? '';
  assert(login.ok && setCookie.includes('ops_session='), 'K) ops login sets cookie', `status ${login.status}`, undefined);
  const me = await fetch(`${OPS_GATEWAY_URL}/ops/auth/me`, { headers: { cookie: setCookie, 'x-correlation-id': rand() } as any });
  const meJson = me.ok ? await me.json() : null;
  assert(!!meJson?.user?.email, 'K) ops auth me', JSON.stringify(meJson), undefined);

  // Cross-gen endorse blocked
  const endorseBlocked = await request(`${ENDORSE_URL}/endorse`, {
    token: tokenB2,
    body: { entry_id: entryId, intent: 'clear' },
  });
  assert(endorseBlocked.res.status === 403, 'G) cross-gen endorse blocked', `status ${endorseBlocked.res.status}`, endorseBlocked.correlationId);

  // Schedule purge window now -> +24h
  const now = new Date();
  const startIso = now.toISOString();
  const schedule = await request(`${PURGE_URL}/purge/schedule`, {
    opsRole: OPS_ROLE,
    body: { starts_at: startIso },
  });
  assert(schedule.res.ok, 'H) purge scheduled', `status ${schedule.res.status}`, schedule.correlationId);

  // Wait briefly for active
  await sleep(500);
  const status = await request(`${PURGE_URL}/purge/status`);
  const purgeActive = !!status.json?.active;
  assert(purgeActive, 'I) purge active', JSON.stringify(status.json), status.correlationId);

  // Feed during purge: userB sees entry
  const feedBActive = await request(`${DISCOURSE_URL}/feed`, { token: tokenB2 });
  const feedHasEntryActive = (feedBActive.json?.feed || []).some((e: any) => e.id === entryId);
  assert(feedHasEntryActive, 'I) cross-gen feed allowed during purge', undefined, feedBActive.correlationId);

  // Cross-gen reply allowed
  const replyAllowed = await request(`${DISCOURSE_URL}/entries/${entryId}/reply`, {
    token: tokenB2,
    body: { content: 'cross-gen hi' },
    idempotencyKey: rand(),
  });
  assert(replyAllowed.res.ok, 'I) cross-gen reply allowed during purge', `status ${replyAllowed.res.status}`, replyAllowed.correlationId);

  // Cross-gen endorse allowed
  const endorseAllowed = await request(`${ENDORSE_URL}/endorse`, {
    token: tokenB2,
    body: { entry_id: entryId, intent: 'clear' },
    idempotencyKey: rand(),
  });
  assert(endorseAllowed.res.ok, 'I) cross-gen endorse allowed during purge', `status ${endorseAllowed.res.status}`, endorseAllowed.correlationId);

  // Always reset purge at end so dev UX doesn't unexpectedly open in Gathering.
  const resetEnd = await request(`${PURGE_URL}/purge/reset`, { opsRole: OPS_ROLE, method: 'POST', body: {} });
  assert(resetEnd.res.ok, 'Purge reset (end)', `status ${resetEnd.res.status}`, resetEnd.correlationId);

  // Kafka/outbox sanity: discourse outbox should be empty (published)
  const outbox = await request(`${DISCOURSE_URL}/admin/outbox`, { opsRole: OPS_ROLE });
  const outboxLen = (outbox.json?.outbox || []).length;
  assert(outboxLen === 0, 'Outbox empty', `len ${outboxLen}`, outbox.correlationId);

  // Rate limit assertion on safety reports (limit 10/min)
  let rlHit = false;
  for (let i = 0; i < 12; i++) {
    const rlim = await request(`${SAFETY_URL}/reports`, {
      token: tokenA2,
      body: { target_type: 'entry', target_id: entryId, reason: `spam-${i}` },
    });
    if (rlim.res.status === 429) {
      rlHit = true;
      break;
    }
  }
  assert(rlHit, 'Rate limit triggers on reports', undefined, undefined);

  // Events checks
  const checkEvent = (events: any[], type: string) => events.some((e) => e.event_type === type);

  const idEvents = await request(`${IDENTITY_URL}/events`, { opsRole: OPS_ROLE, method: 'GET' });
  assert(checkEvent(idEvents.json?.events || [], 'identity.generation_verified'), 'J) identity events present', undefined, idEvents.correlationId);

  const discEvents = await request(`${DISCOURSE_URL}/events`, { opsRole: OPS_ROLE });
  assert(checkEvent(discEvents.json?.events || [], 'discourse.entry_created'), 'J) entry event present', undefined, discEvents.correlationId);
  assert(checkEvent(discEvents.json?.events || [], 'discourse.reply_created'), 'J) reply event present', undefined, discEvents.correlationId);

  const credEvents = await request(`${CRED_URL}/events`, { opsRole: OPS_ROLE });
  assert(checkEvent(credEvents.json?.events || [], 'cred.spent'), 'J) cred event present', undefined, credEvents.correlationId);

  const endorseEvents = await request(`${ENDORSE_URL}/events`, { opsRole: OPS_ROLE });
  assert(checkEvent(endorseEvents.json?.events || [], 'endorse.created'), 'J) endorse event present', undefined, endorseEvents.correlationId);

  // Safety + trust minimal reachability (optional)
  const safetyHealth = await request(`${SAFETY_URL}/healthz`);
  assert(safetyHealth.res.ok, 'safety health', undefined, safetyHealth.correlationId);
  const trustHealth = await request(`${TRUST_URL}/healthz`);
  assert(trustHealth.res.ok, 'trust health', undefined, trustHealth.correlationId);

  // Report
  const failures = results.filter((r) => !r.ok);
  results.forEach((r) =>
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'} | ${r.name}${
        r.detail ? ` | ${r.detail}` : ''
      }${r.correlationId ? ` | corr=${r.correlationId}` : ''}`,
    ),
  );
  if (process.env.SMOKE_DOWN === '1') {
    try {
      execSync('pnpm core:down', { stdio: 'inherit' });
    } catch (err) {
      console.error('Failed to stop core stack', err);
    }
  }
  if (failures.length > 0) {
    process.exitCode = 1;
  }
};

main().catch((err) => {
  console.error('Smoke run error', err);
  process.exit(1);
});

