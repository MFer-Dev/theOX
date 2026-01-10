import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fs from 'fs';
import path from 'path';
import {
  ensureCorrelationId,
  verifyAccess,
  getPool,
  withIdempotency,
  AssumptionType,
  GenerationCohort,
  recordOutbox,
  dispatchOutbox,
  rateLimitMiddleware,
} from '@platform/shared';
import { buildEvent, persistEvent, publishEvent } from '@platform/events';
import { createLocalProvider } from './media/providers/local';
import { createS3StubProvider } from './media/providers/s3_stub';

const pool = getPool('discourse');
const credUrl = process.env.CRED_URL ?? 'http://localhost:4004';
const purgeUrl = process.env.PURGE_URL ?? 'http://localhost:4003';
const identityUrl = process.env.IDENTITY_URL ?? 'http://localhost:4001';
const trustUrl = process.env.TRUST_URL ?? 'http://localhost:4007';

const BODY_LIMIT = Number(process.env.DISCOURSE_BODY_LIMIT ?? 25 * 1024 * 1024);
const app = Fastify({ logger: true, bodyLimit: BODY_LIMIT });

const MEDIA_MAX_BYTES = Number(process.env.MEDIA_MAX_BYTES ?? 15 * 1024 * 1024);
const ALLOWED_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
]);

const mediaExtForType = (contentType: string) => {
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('heic') || ct.includes('heif')) return 'heic';
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('quicktime')) return 'mov';
  return 'jpg';
};

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, {
  openapi: {
    info: { title: 'Discourse Service', version: '0.1.0' },
  },
});
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

const appendEvent = async (
  type: string,
  payload: unknown,
  actorId: string,
  generation: GenerationCohort,
  correlationId?: string,
  idempotencyKey?: string,
) => {
  const evt = buildEvent(type, payload, {
    actorId,
    actorGeneration: generation,
    correlationId,
  });
  await persistEvent(pool, evt, { idempotencyKey, context: payload as Record<string, unknown> });
  const topic = 'events.discourse.v1';
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

type PurgeStatus = {
  active: boolean;
  status?: string;
  starts_at?: string | null;
  ends_at?: string | null;
  last_starts_at?: string | null;
  last_ends_at?: string | null;
};

const getPurgeStatus = async (): Promise<PurgeStatus> => {
  try {
    const res = await fetch(`${purgeUrl}/purge/status`);
    return (await res.json()) as PurgeStatus;
  } catch {
    return { active: false, ends_at: null, last_ends_at: null, starts_at: null, last_starts_at: null };
  }
};

const maybeRejectGatheringEnded = async (request: any, reply: any) => {
  const hdr = (request.headers['x-trybl-world'] ?? request.headers['x-world']) as string | undefined;
  const wantsGathering = (hdr ?? '').toLowerCase() === 'gathering';
  if (!wantsGathering) return false;

  const purge = await getPurgeStatus();
  const now = Date.now();
  const endsAt = purge.ends_at ? new Date(purge.ends_at).getTime() : null;
  const lastEndsAt = purge.last_ends_at ? new Date(purge.last_ends_at).getTime() : null;

  // Safety: if a service clock drift or stale status says "active" after ends_at, treat it as ended.
  if (typeof endsAt === 'number' && Number.isFinite(endsAt) && now > endsAt) {
    reply.status(410);
    return { error: 'gathering_ended', ends_at: purge.ends_at ?? null };
  }

  // If the most recent window ended very recently, treat any "gathering-world" write as invalid.
  // This prevents an in-flight compose/reply from accidentally being accepted into Tribal World.
  if (typeof lastEndsAt === 'number' && Number.isFinite(lastEndsAt) && now > lastEndsAt) {
    const graceMs = 10 * 60_000;
    if (now - lastEndsAt <= graceMs) {
      reply.status(410);
      return { error: 'gathering_ended', ends_at: purge.last_ends_at ?? null };
    }
  }

  return false;
};

const getAuthor = async (userId: string) => {
  try {
    const res = await fetch(`${identityUrl}/internal/users/${userId}`, { headers: { 'x-internal-call': 'true' } });
    if (!res.ok) return null;
    const json: any = await res.json();
    const u = json?.user;
    return u
      ? { handle: u.handle, display_name: u.display_name ?? u.handle, avatar_url: u.avatar_url ?? null }
      : null;
  } catch {
    return null;
  }
};

const getCredibilityMap = async (userIds: string[]) => {
  const ids = Array.from(new Set(userIds.filter(Boolean))).slice(0, 200);
  if (!ids.length) return new Map<string, number>();
  try {
    const qs = new URLSearchParams({ ids: ids.join(',') });
    const res = await fetch(`${trustUrl}/internal/credibility?${qs.toString()}`, {
      headers: { 'x-internal-call': 'true' },
    });
    if (!res.ok) return new Map<string, number>();
    const json: any = await res.json();
    const m = new Map<string, number>();
    const users = json?.users ?? {};
    for (const k of Object.keys(users)) m.set(k, Number(users[k] ?? 0));
    return m;
  } catch {
    return new Map<string, number>();
  }
};

// --- Feed ranking (transparent + anti-echo-chamber) ---
type Why = { code: string; label: string; weight: number };

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

const recencyScore = (createdAt?: string | null) => {
  if (!createdAt) return 0;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return 0;
  const hours = Math.max(0, (Date.now() - t) / 36e5);
  // Half-life ~24h
  return Math.exp(-hours / 24);
};

const engagementScore = (it: any) => {
  const like = Number(it?.like_count ?? it?.likeCount ?? 0);
  const repost = Number(it?.repost_count ?? it?.repostCount ?? 0);
  const reply = Number(it?.reply_count ?? it?.replyCount ?? 0);
  const bm = Number(it?.bookmark_count ?? it?.bookmarkCount ?? 0);
  const raw = like * 1 + repost * 1.4 + reply * 1.2 + bm * 0.6;
  // Soft cap to avoid runaway
  return 1 - Math.exp(-raw / 12);
};

const rankFeed = (
  items: any[],
  topicAffinity: Map<string, number>,
  authorCred: Map<string, number>,
  opts: { gathering: boolean },
) => {
  const maxAff = Math.max(1, ...Array.from(topicAffinity.values()));
  const maxCred = Math.max(1, ...Array.from(authorCred.values()).map((v) => Math.abs(v)));
  const scored = items.map((it: any) => {
    const why: Why[] = [];
    const r = recencyScore(it?.created_at ?? it?.createdAt);
    const e = engagementScore(it);
    const topic = String(it?.topic ?? '').trim().toLowerCase();
    const aff = topic ? (topicAffinity.get(topic) ?? 0) / maxAff : 0;
    const authorId = String(it?.user_id ?? it?.author_id ?? it?.author?.id ?? '');
    const credRaw = authorId ? authorCred.get(authorId) ?? 0 : 0;
    // Normalize to 0..1 using a tanh squashing around 0.
    const cred = clamp01(0.5 + Math.tanh((credRaw / maxCred) * 0.8) * 0.5);

    // Base weights are intentionally modest; diversification is the bigger lever.
    const wRecency = opts.gathering ? 0.45 : 0.55;
    const wEngage = opts.gathering ? 0.30 : 0.25;
    const wAff = opts.gathering ? 0.12 : 0.18;
    const wExplore = opts.gathering ? 0.13 : 0.02;
    const wCred = opts.gathering ? 0.06 : 0.08;
    const explore = topic ? 1 - clamp01(aff) : 0.6;

    const score = wRecency * r + wEngage * e + wAff * aff + wExplore * explore + wCred * cred;
    if (r > 0.4) why.push({ code: 'recent', label: 'Recent', weight: wRecency * r });
    if (e > 0.15) why.push({ code: 'engagement', label: 'High engagement', weight: wEngage * e });
    if (aff > 0.05 && topic) why.push({ code: 'affinity_topic', label: `Because you engage with #${topic}`, weight: wAff * aff });
    if (cred > 0.7) why.push({ code: 'credibility', label: 'Credibility signal', weight: wCred * cred });
    if (explore > 0.6) why.push({ code: 'explore', label: 'Exploration pick (avoid echo chamber)', weight: wExplore * explore });

    return { it, score, why: why.sort((a, b) => b.weight - a.weight).slice(0, 3) };
  });

  scored.sort((a, b) => b.score - a.score);

  // Diversify: limit repeated authors/topics and reserve some exploration.
  const out: any[] = [];
  const seen = new Set<string>();
  let lastAuthor: string | null = null;
  let lastTopic: string | null = null;
  const topicRun = new Map<string, number>();

  const pick = (predicate: (x: any) => boolean) => {
    for (const s of scored) {
      const id = String(s.it?.id ?? s.it?.entry_id ?? '');
      if (!id || seen.has(id)) continue;
      if (!predicate(s)) continue;
      seen.add(id);
      out.push({
        ...s.it,
        rank: { score: s.score, why: s.why, algo: 'feed_rank_v1' },
      });
      const a = String(s.it?.user_id ?? s.it?.author_id ?? s.it?.author?.id ?? '');
      const t = String(s.it?.topic ?? '').trim().toLowerCase() || null;
      lastAuthor = a || lastAuthor;
      lastTopic = t || lastTopic;
      if (t) topicRun.set(t, (topicRun.get(t) ?? 0) + 1);
      return true;
    }
    return false;
  };

  while (out.length < Math.min(50, scored.length)) {
    const i = out.length;
    const explorationSlot = opts.gathering ? i % 5 === 0 : i % 9 === 0; // ~20% gathering, ~11% tribal
    const ok = pick((s) => {
      const a = String(s.it?.user_id ?? s.it?.author_id ?? s.it?.author?.id ?? '');
      const t = String(s.it?.topic ?? '').trim().toLowerCase() || null;
      if (a && lastAuthor && a === lastAuthor) return false;
      if (t && lastTopic && t === lastTopic) return false;
      if (t && (topicRun.get(t) ?? 0) >= 8) return false;
      if (explorationSlot) {
        return s.why.some((w: Why) => w.code === 'explore');
      }
      return true;
    });
    if (!ok) {
      // Fallback: accept best remaining to avoid empty feed.
      if (!pick(() => true)) break;
    }
  }

  return out;
};

const topicAffinityFor = async (viewerId: string) => {
  // Derived interest vector from the user's own interactions + replies (last 30d).
  const map = new Map<string, number>();
  try {
    const inter = await pool.query(
      `select lower(coalesce(e.topic,'')) as topic, count(*)::int as c
       from entry_interactions i
       join entries e on e.id = i.entry_id
       where i.user_id=$1 and e.deleted_at is null and e.created_at > now() - interval '30 days'
       group by 1`,
      [viewerId],
    );
    for (const r of inter.rows) {
      const t = String(r.topic ?? '').trim();
      if (!t) continue;
      map.set(t, (map.get(t) ?? 0) + Number(r.c ?? 0));
    }
    const reps = await pool.query(
      `select lower(coalesce(e.topic,'')) as topic, count(*)::int as c
       from replies r
       join entries e on e.id = r.entry_id
       where r.user_id=$1 and e.deleted_at is null and r.created_at > now() - interval '30 days'
       group by 1`,
      [viewerId],
    );
    for (const r of reps.rows) {
      const t = String(r.topic ?? '').trim();
      if (!t) continue;
      map.set(t, (map.get(t) ?? 0) + Number(r.c ?? 0));
    }
  } catch {
    // ignore
  }
  return map;
};

const getBlockedGraph = async (viewerId: string) => {
  try {
    const res = await fetch(`${identityUrl}/internal/relationships/blocked/${encodeURIComponent(viewerId)}`, {
      headers: { 'x-internal-call': 'true' },
    });
    if (!res.ok) return { blocked: new Set<string>(), blockedBy: new Set<string>() };
    const json: any = await res.json();
    const blocked = new Set<string>((json?.blocked_user_ids ?? []).filter(Boolean));
    const blockedBy = new Set<string>((json?.blocked_by_user_ids ?? []).filter(Boolean));
    return { blocked, blockedBy };
  } catch {
    return { blocked: new Set<string>(), blockedBy: new Set<string>() };
  }
};

const spendCred = async (
  authHeader: string | undefined,
  bucket: 'CLAIM' | 'REPLY',
  correlationId?: string,
  idempotencyKey?: string,
) => {
  const res = await fetch(`${credUrl}/cred/spend`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authHeader ? { authorization: authHeader } : {}),
      'x-correlation-id': correlationId ?? '',
      'x-idempotency-key': idempotencyKey ?? '',
    },
    body: JSON.stringify({ bucket, reason_code: 'discourse' }),
  });
  if (!res.ok) {
    throw new Error('cred spend failed');
  }
  return res.json();
};

const quoteEmbedFor = async (
  auth: any,
  quoteEntryId: string | null | undefined,
  purgeActive: boolean,
  blocked: Set<string>,
  blockedBy: Set<string>,
) => {
  if (!quoteEntryId) return null;
  const qRes = await pool.query('select * from entries where id=$1', [quoteEntryId]);
  if (!qRes.rowCount) return null;
  const q = qRes.rows[0];
  if (q.deleted_at) return null;
  if (!purgeActive && q.generation !== auth.generation) return null;
  if (blocked.has(q.user_id) || blockedBy.has(q.user_id)) return null;
  return {
    id: q.id,
    body: q.body,
    topic: q.topic ?? null,
    created_at: q.created_at,
    media: q.media ?? [],
    ai_assisted: Boolean(q.ai_assisted),
    author: await getAuthor(q.user_id),
  };
};

const viewerMapFor = async (viewerId: string, entryIds: string[]) => {
  if (!entryIds.length) return new Map<string, any>();
  const res = await pool.query(
    `select entry_id, kind from entry_interactions where user_id=$1 and entry_id = any($2::uuid[])`,
    [viewerId, entryIds],
  );
  const map = new Map<string, { liked?: boolean; reposted?: boolean; bookmarked?: boolean }>();
  for (const r of res.rows) {
    const e = map.get(r.entry_id) ?? {};
    if (r.kind === 'like') e.liked = true;
    if (r.kind === 'repost') e.reposted = true;
    if (r.kind === 'bookmark') e.bookmarked = true;
    map.set(r.entry_id, e);
  }
  return map;
};

const viewerMapForReplies = async (viewerId: string, replyIds: string[]) => {
  if (!replyIds.length) return new Map<string, any>();
  const res = await pool.query(
    `select reply_id, kind from reply_interactions where user_id=$1 and reply_id = any($2::uuid[])`,
    [viewerId, replyIds],
  );
  const map = new Map<string, { liked?: boolean; reposted?: boolean; bookmarked?: boolean }>();
  for (const r of res.rows) {
    const e = map.get(r.reply_id) ?? {};
    if (r.kind === 'like') e.liked = true;
    if (r.kind === 'repost') e.reposted = true;
    if (r.kind === 'bookmark') e.bookmarked = true;
    map.set(r.reply_id, e);
  }
  return map;
};

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));
app.get('/metrics', async () => ({ status: 'ok' }));

const MEDIA_DIR = process.env.MEDIA_DIR ?? path.join(process.cwd(), 'media_store');
const MEDIA_PUBLIC_BASE_URL = process.env.MEDIA_PUBLIC_BASE_URL ?? 'http://localhost:4000/discourse/media';
const MEDIA_PROVIDER = String(process.env.MEDIA_PROVIDER ?? 'local').toLowerCase(); // local | s3

const ensureMediaDir = async () => {
  try {
    await fs.promises.mkdir(MEDIA_DIR, { recursive: true });
  } catch {
    // ignore
  }
};

const safeB64 = (input: string) => {
  // support both "raw base64" and "data:*;base64,...."
  const idx = input.indexOf('base64,');
  return idx >= 0 ? input.slice(idx + 'base64,'.length) : input;
};

// Media upload (provider stub): returns an upload plan.
// In production this should return signed URLs (S3/GCS) and enforce MIME/type/size.
app.post('/media/upload-url', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation || !auth.verified) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const body = request.body as { type?: string; content_type?: string; byte_size?: number; filename?: string };
  const type = String(body?.type ?? 'image');
  // Minimal validation hooks (dev): reject absurd sizes.
  const byteSize = Number(body?.byte_size ?? 0);
  if (byteSize && byteSize > 15 * 1024 * 1024) {
    reply.status(413);
    return { error: 'payload_too_large' };
  }

  const provider =
    MEDIA_PROVIDER === 's3'
      ? createS3StubProvider()
      : // Default: local-upload plan (App Store QA). Replace with object storage in production.
        createLocalProvider({ publicBaseUrl: MEDIA_PUBLIC_BASE_URL });

  try {
    const plan = await provider.createUploadPlan({
      user_id: auth.sub,
      type: type === 'video' ? 'video' : 'image',
      content_type: body?.content_type ?? null,
      byte_size: byteSize || null,
      filename: body?.filename ?? null,
    });

    // Persist a planned media object (so production finalize/moderation/thumbnail hooks have a record).
    await pool.query(
      `insert into media_objects (id, user_id, content_type, filename, byte_size, storage_path, provider, object_key, public_url, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (id) do nothing`,
      [
        plan.id,
        auth.sub,
        body?.content_type ?? 'application/octet-stream',
        body?.filename ?? null,
        byteSize || null,
        '',
        plan.provider,
        plan.object_key ?? null,
        plan.public_url,
        'planned',
      ],
    );

    return {
      ok: true,
      upload: {
        id: plan.id,
        type,
        provider: plan.provider,
        upload_url: plan.upload_url,
        headers: plan.headers ?? {},
        public_url: plan.public_url,
        expires_at: plan.expires_at ?? null,
        object_key: plan.object_key ?? null,
        content_type: body?.content_type ?? null,
        byte_size: byteSize || null,
        filename: body?.filename ?? null,
      },
    };
  } catch (e: any) {
    reply.status(501);
    return { error: e?.message ?? 'media_provider_not_configured' };
  }
});

// JSON-base64 upload (dev/local storage). This is App Store QA-friendly; swap for signed object storage in prod.
app.post('/media/upload', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation || !auth.verified) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const body = request.body as { id?: string; filename?: string; content_type?: string; data_base64?: string };
  const id = String(body?.id ?? '').trim() || ((globalThis as any).crypto?.randomUUID?.() ?? `${Date.now()}`);
  const contentType = String(body?.content_type ?? 'image/jpeg').toLowerCase();
  const filename = String(body?.filename ?? 'upload').slice(0, 180);
  const b64 = String(body?.data_base64 ?? '').trim();
  if (!b64) {
    reply.status(400);
    return { error: 'data_base64 required' };
  }
  if (!ALLOWED_MEDIA_TYPES.has(contentType)) {
    reply.status(415);
    return { error: 'unsupported_media_type', content_type: contentType };
  }
  await ensureMediaDir();
  const buf = Buffer.from(safeB64(b64), 'base64');
  if (buf.length > MEDIA_MAX_BYTES) {
    reply.status(413);
    return { error: 'payload_too_large', byte_size: buf.length, max_bytes: MEDIA_MAX_BYTES };
  }
  const ext = mediaExtForType(contentType);
  const file = `${id}.${ext}`;
  const storagePath = path.join(MEDIA_DIR, file);
  await fs.promises.writeFile(storagePath, buf);

  // upsert metadata (id is client-supplied/plan-supplied)
  await pool.query(
    `insert into media_objects (id, user_id, content_type, filename, byte_size, storage_path)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (id) do update set content_type=$3, filename=$4, byte_size=$5, storage_path=$6, provider='local', public_url=$7, status='uploaded'`,
    [id, auth.sub, contentType, filename, buf.length, storagePath, `${MEDIA_PUBLIC_BASE_URL}/${encodeURIComponent(id)}`],
  );

  return {
    ok: true,
    media: { id, content_type: contentType, byte_size: buf.length, public_url: `${MEDIA_PUBLIC_BASE_URL}/${encodeURIComponent(id)}` },
  };
});

// Local job runner for media finalize (thumbnail/moderation scaffolds).
// In production, this becomes workers/queues; locally we keep it simple and deterministic.
const processMediaJobsOnce = async () => {
  const job = await pool.query(
    `update media_jobs
     set status='running', attempts=attempts+1, updated_at=now()
     where id = (
       select id from media_jobs where status='queued'
       order by created_at asc
       limit 1
     )
     returning *`,
  );
  if (!job.rowCount) return;
  const j = job.rows[0] as any;
  try {
    const m = await pool.query('select id, public_url from media_objects where id=$1', [j.media_id]);
    if (!m.rowCount) throw new Error('media_not_found');
    const publicUrl = String(m.rows[0].public_url ?? '');
    if (String(j.job_type) === 'moderate') {
      await pool.query(`update media_objects set moderation_status='approved' where id=$1`, [j.media_id]);
    } else if (String(j.job_type) === 'thumbnail') {
      // No-op thumbnails for local: reuse public URL so clients can display "thumbs" without extra infra.
      await pool.query(
        `update media_objects
         set thumb_small_url=$2, thumb_medium_url=$2, thumb_large_url=$2
         where id=$1`,
        [j.media_id, publicUrl],
      );
    }
    await pool.query(`update media_jobs set status='done', updated_at=now() where id=$1`, [j.id]);
  } catch (e: any) {
    await pool.query(`update media_jobs set status='failed', last_error=$2, updated_at=now() where id=$1`, [
      j.id,
      String(e?.message ?? 'job_failed').slice(0, 800),
    ]);
  }
};

app.get('/media/:id', async (request, reply) => {
  const id = (request.params as any).id as string;
  const row = await pool.query('select content_type, storage_path from media_objects where id=$1', [id]);
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not_found' };
  }
  const m = row.rows[0];
  try {
    const data = await fs.promises.readFile(String(m.storage_path));
    reply.header('content-type', String(m.content_type ?? 'application/octet-stream'));
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.send(data);
  } catch {
    reply.status(404);
    return { error: 'not_found' };
  }
});

// Finalize hook (production scaffold). For local uploads, this is a no-op. For object storage, this would:
// - verify object exists
// - enqueue thumbnail + moderation jobs
// - return derived URLs
app.post('/media/finalize', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation || !auth.verified) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const body = (request.body ?? {}) as { id?: string };
  const id = String(body.id ?? '').trim();
  if (!id) {
    reply.status(400);
    return { error: 'id required' };
  }
  const row = await pool.query('select id, provider from media_objects where id=$1 and user_id=$2', [id, auth.sub]);
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not_found' };
  }
  const provider = String(row.rows[0].provider ?? 'local');
  await pool.query('update media_objects set status=$2 where id=$1', [id, 'uploaded']);
  await pool.query('insert into media_jobs (media_id, job_type) values ($1,$2) on conflict do nothing', [id, 'moderate']);
  await pool.query('insert into media_jobs (media_id, job_type) values ($1,$2) on conflict do nothing', [id, 'thumbnail']);
  return { ok: true, provider, queued: true };
});

app.post('/entries', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation || !auth.verified) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const ended = await maybeRejectGatheringEnded(request, reply);
  if (ended) return ended;
  const body = request.body as {
    assumption_type: AssumptionType;
    content: string;
    media?: { url: string; type: string }[];
    ai_assisted?: boolean;
    quote_entry_id?: string;
  };
  if (!body.assumption_type || !Object.values(AssumptionType).includes(body.assumption_type)) {
    reply.status(400);
    return { error: 'assumption_type required' };
  }
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  const topic = (request.body as any)?.topic ?? null;
  const media = Array.isArray((request.body as any)?.media) ? (request.body as any).media : [];
  const aiAssisted = Boolean((request.body as any)?.ai_assisted);
  const quoteEntryId = (request.body as any)?.quote_entry_id as string | undefined;
  await rateLimitMiddleware({ key: `entries:${auth.sub}`, limit: 10, windowSec: 60 })(request, reply);
  const result = await withIdempotency(pool, idempotencyKey, async () => {
    await spendCred(request.headers.authorization as string | undefined, 'CLAIM', correlationId, idempotencyKey);
    if (quoteEntryId) {
      const qRes = await pool.query('select id, user_id, generation, deleted_at from entries where id=$1', [quoteEntryId]);
      if (!qRes.rowCount || qRes.rows[0].deleted_at) {
        reply.status(404);
        return { error: 'quote target not found' };
      }
      const q = qRes.rows[0];
      const purge = await getPurgeStatus();
      if (!purge.active && q.generation !== auth.generation) {
        reply.status(403);
        return { error: 'cross-gen blocked' };
      }
      const { blocked, blockedBy } = await getBlockedGraph(auth.sub);
      if (blocked.has(q.user_id) || blockedBy.has(q.user_id)) {
        reply.status(403);
        return { error: 'blocked' };
      }
    }
    const entry = await pool.query(
      'insert into entries (user_id, generation, topic, assumption_type, body, quote_entry_id, ai_assisted, media) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *',
      [
        auth.sub,
        auth.generation,
        topic,
        body.assumption_type,
        body.content ?? '',
        quoteEntryId ?? null,
        aiAssisted,
        JSON.stringify(media ?? []),
      ],
    );
    await pool.query(
      `insert into timeline_items (entry_id, generation, author_id, topic, assumption_type, body_preview, quote_entry_id, ai_assisted, media_preview)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (entry_id) do nothing`,
      [
        entry.rows[0].id,
        auth.generation,
        auth.sub,
        topic,
        body.assumption_type,
        (body.content ?? '').slice(0, 140),
        quoteEntryId ?? null,
        aiAssisted,
        JSON.stringify(media ?? []),
      ],
    );
    const evt = await appendEvent(
      'discourse.entry_created',
      {
        entry_id: entry.rows[0].id,
        topic,
        assumption_type: body.assumption_type,
        generation: auth.generation,
        quote_entry_id: quoteEntryId ?? null,
      },
      auth.sub,
      auth.generation as GenerationCohort,
      correlationId,
      idempotencyKey,
    );
    return { entry: entry.rows[0], event_id: evt.event_id };
  });
  return result;
});

app.get('/feed', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const purge = await getPurgeStatus();
  const { blocked, blockedBy } = await getBlockedGraph(auth.sub);
  const topic = (request.query as any)?.topic as string | undefined;
  const affinity = await topicAffinityFor(auth.sub);
  if (purge.active) {
    const rows = await pool.query(
      topic
        ? 'select * from entries where deleted_at is null and topic=$1 order by created_at desc limit 200'
        : 'select * from entries where deleted_at is null order by created_at desc limit 200',
      topic ? [topic] : [],
    );
    const ids = rows.rows.map((r: any) => r.id);
    const viewers = await viewerMapFor(auth.sub, ids);
    const hydrated = await Promise.all(
      rows.rows.map(async (r) => ({
        ...r,
        media: r.media ?? [],
        ai_assisted: Boolean(r.ai_assisted),
        quote: await quoteEmbedFor(auth, r.quote_entry_id, true, blocked, blockedBy),
        author: await getAuthor(r.user_id),
        viewer: viewers.get(r.id) ?? { liked: false, reposted: false, bookmarked: false },
      })),
    );
    const filtered = hydrated.filter((e: any) => !(blocked.has(e.user_id) || blockedBy.has(e.user_id)));
    const authorIds = filtered.map((e: any) => String(e.user_id ?? '')).filter(Boolean);
    const cred = await getCredibilityMap(authorIds);
    const ranked = rankFeed(filtered, affinity, cred, { gathering: true });
    return { feed: ranked, purge_active: true, materialized: false, topic: topic ?? null, algo: 'feed_rank_v1' };
  }
  const rows = await pool.query(
    topic
      ? 'select * from timeline_items where generation=$1 and topic=$2 order by created_at desc limit 200'
      : 'select * from timeline_items where generation=$1 order by created_at desc limit 200',
    topic ? [auth.generation, topic] : [auth.generation],
  );
  const ids = rows.rows.map((r: any) => r.entry_id).filter(Boolean);
  const viewers = await viewerMapFor(auth.sub, ids);
  const hydrated = await Promise.all(
    rows.rows.map(async (r) => ({
      ...r,
      // Normalize timeline items to entry-like shape for mobile.
      id: r.entry_id,
      body: r.body_preview ?? '',
      media: r.media_preview ?? [],
      ai_assisted: Boolean(r.ai_assisted),
      quote: await quoteEmbedFor(auth, r.quote_entry_id, false, blocked, blockedBy),
      author: await getAuthor(r.author_id),
      viewer: viewers.get(r.entry_id) ?? { liked: false, reposted: false, bookmarked: false },
      like_count: r.like_count,
      repost_count: r.repost_count,
      reply_count: r.reply_count,
      bookmark_count: r.bookmark_count,
    })),
  );
  const filtered = hydrated.filter((e: any) => !(blocked.has(e.author_id) || blockedBy.has(e.author_id)));
  const authorIds = filtered.map((e: any) => String(e.author_id ?? '')).filter(Boolean);
  const cred = await getCredibilityMap(authorIds);
  const ranked = rankFeed(filtered, affinity, cred, { gathering: false });
  return { feed: ranked, purge_active: false, materialized: true, topic: topic ?? null, algo: 'feed_rank_v1' };
});

app.post('/entries/:id/reply', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation || !auth.verified) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const ended = await maybeRejectGatheringEnded(request, reply);
  if (ended) return ended;
  const entryId = (request.params as any)['id'];
  const body = request.body as { content: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  const idempotencyKey = request.headers['x-idempotency-key'] as string | undefined;
  await rateLimitMiddleware({ key: `replies:${auth.sub}`, limit: 20, windowSec: 60 })(request, reply);
  const entryRes = await pool.query('select * from entries where id=$1', [entryId]);
  if (entryRes.rowCount === 0) {
    reply.status(404);
    return { error: 'entry not found' };
  }
  if (entryRes.rows[0].deleted_at) {
    reply.status(404);
    return { error: 'entry not found' };
  }
  const { blocked, blockedBy } = await getBlockedGraph(auth.sub);
  const authorId = entryRes.rows[0].user_id as string;
  if (blocked.has(authorId) || blockedBy.has(authorId)) {
    reply.status(403);
    return { error: 'blocked' };
  }
  const purge = await getPurgeStatus();
  if (!purge.active && entryRes.rows[0].generation !== auth.generation) {
    reply.status(403);
    return { error: 'cross-gen replies blocked' };
  }
  const result = await withIdempotency(pool, idempotencyKey, async () => {
    await spendCred(request.headers.authorization as string | undefined, 'REPLY', correlationId, idempotencyKey);
    const rep = await pool.query(
      'insert into replies (entry_id, user_id, generation, body) values ($1,$2,$3,$4) returning *',
      [entryId, auth.sub, auth.generation, body.content ?? ''],
    );
    await pool.query('update timeline_items set reply_count = reply_count + 1 where entry_id=$1', [entryId]);
    await pool.query('update entries set reply_count = reply_count + 1 where id=$1', [entryId]);
    const evt = await appendEvent(
      'discourse.reply_created',
      { reply_id: rep.rows[0].id, entry_id: entryId, cross_gen: entryRes.rows[0].generation !== auth.generation },
      auth.sub,
      auth.generation as GenerationCohort,
      correlationId,
      idempotencyKey,
    );
    return { reply: rep.rows[0], event_id: evt.event_id };
  });
  return result;
});

app.post('/entries/:id/interactions/toggle', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const ended = await maybeRejectGatheringEnded(request, reply);
  if (ended) return ended;
  const entryId = (request.params as any)['id'] as string;
  const body = request.body as { kind?: 'like' | 'repost' | 'bookmark' };
  const kind = body.kind;
  if (!kind || !['like', 'repost', 'bookmark'].includes(kind)) {
    reply.status(400);
    return { error: 'kind required' };
  }
  const exists = await pool.query('select user_id, deleted_at from entries where id=$1', [entryId]);
  if (!exists.rowCount || exists.rows[0].deleted_at) {
    reply.status(404);
    return { error: 'not found' };
  }
  const { blocked, blockedBy } = await getBlockedGraph(auth.sub);
  const authorId = exists.rows[0].user_id as string;
  if (blocked.has(authorId) || blockedBy.has(authorId)) {
    reply.status(403);
    return { error: 'blocked' };
  }
  const prev = await pool.query('select 1 from entry_interactions where entry_id=$1 and user_id=$2 and kind=$3', [
    entryId,
    auth.sub,
    kind,
  ]);
  const active = prev.rowCount === 0;
  if (active) {
    await pool.query(
      `insert into entry_interactions (entry_id, user_id, kind) values ($1,$2,$3)
       on conflict (entry_id, user_id, kind) do nothing`,
      [entryId, auth.sub, kind],
    );
  } else {
    await pool.query('delete from entry_interactions where entry_id=$1 and user_id=$2 and kind=$3', [entryId, auth.sub, kind]);
  }
  const delta = active ? 1 : -1;
  const col = kind === 'like' ? 'like_count' : kind === 'repost' ? 'repost_count' : 'bookmark_count';
  await pool.query(`update entries set ${col} = greatest(0, ${col} + $2) where id=$1`, [entryId, delta]);
  await pool.query(`update timeline_items set ${col} = greatest(0, ${col} + $2) where entry_id=$1`, [entryId, delta]);
  const counts = await pool.query('select like_count, repost_count, bookmark_count, reply_count from entries where id=$1', [entryId]);
  return { ok: true, active, kind, counts: counts.rows[0] };
});

app.post('/replies/:id/interactions/toggle', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const ended = await maybeRejectGatheringEnded(request, reply);
  if (ended) return ended;
  const replyId = (request.params as any)['id'] as string;
  const body = request.body as { kind?: 'like' | 'repost' | 'bookmark' };
  const kind = body.kind;
  if (!kind || !['like', 'repost', 'bookmark'].includes(kind)) {
    reply.status(400);
    return { error: 'kind required' };
  }
  const exists = await pool.query('select id, user_id from replies where id=$1', [replyId]);
  if (!exists.rowCount) {
    reply.status(404);
    return { error: 'not found' };
  }
  const { blocked, blockedBy } = await getBlockedGraph(auth.sub);
  const authorId = exists.rows[0].user_id as string;
  if (blocked.has(authorId) || blockedBy.has(authorId)) {
    reply.status(403);
    return { error: 'blocked' };
  }
  const prev = await pool.query('select 1 from reply_interactions where reply_id=$1 and user_id=$2 and kind=$3', [
    replyId,
    auth.sub,
    kind,
  ]);
  const active = prev.rowCount === 0;
  if (active) {
    await pool.query(
      `insert into reply_interactions (reply_id, user_id, kind) values ($1,$2,$3)
       on conflict (reply_id, user_id, kind) do nothing`,
      [replyId, auth.sub, kind],
    );
  } else {
    await pool.query('delete from reply_interactions where reply_id=$1 and user_id=$2 and kind=$3', [replyId, auth.sub, kind]);
  }
  const delta = active ? 1 : -1;
  const col = kind === 'like' ? 'like_count' : kind === 'repost' ? 'repost_count' : 'bookmark_count';
  await pool.query(`update replies set ${col} = greatest(0, ${col} + $2) where id=$1`, [replyId, delta]);
  const counts = await pool.query('select like_count, repost_count, bookmark_count from replies where id=$1', [replyId]);
  return { ok: true, active, kind, counts: counts.rows[0] };
});

app.get('/bookmarks', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const ids = await pool.query(
    `select entry_id from entry_interactions where user_id=$1 and kind='bookmark' order by created_at desc limit 200`,
    [auth.sub],
  );
  if (!ids.rowCount) return { feed: [] };
  const entries = await pool.query('select * from entries where deleted_at is null and id = any($1::uuid[])', [
    ids.rows.map((r: any) => r.entry_id),
  ]);
  const { blocked, blockedBy } = await getBlockedGraph(auth.sub);
  const viewers = await viewerMapFor(auth.sub, entries.rows.map((e: any) => e.id));
  const purge = await getPurgeStatus();
  const hydrated = await Promise.all(
    entries.rows.map(async (e: any) => ({
      ...e,
      author: await getAuthor(e.user_id),
      media: e.media ?? [],
      ai_assisted: Boolean(e.ai_assisted),
      quote: await quoteEmbedFor(auth, e.quote_entry_id, purge.active, blocked, blockedBy),
      viewer: viewers.get(e.id) ?? { liked: false, reposted: false, bookmarked: true },
    })),
  );
  const filtered = hydrated.filter((e: any) => !(blocked.has(e.user_id) || blockedBy.has(e.user_id)));
  return { feed: filtered };
});

app.get('/entries/:id/thread', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const entryId = (request.params as any)['id'];
  const entryRes = await pool.query('select * from entries where id=$1', [entryId]);
  if (entryRes.rowCount === 0) {
    reply.status(404);
    return { error: 'not found' };
  }
  const purge = await getPurgeStatus();
  if (entryRes.rows[0].deleted_at) {
    return { removed: true, purge_active: purge.active };
  }
  const { blocked, blockedBy } = await getBlockedGraph(auth.sub);
  const authorId = entryRes.rows[0].user_id as string;
  if (blocked.has(authorId) || blockedBy.has(authorId)) {
    reply.status(403);
    return { blocked: true, reason: 'User blocked' };
  }
  if (!purge.active && entryRes.rows[0].generation !== auth.generation) {
    reply.status(403);
    return { error: 'cross-gen blocked' };
  }
  const replies = await pool.query('select * from replies where deleted_at is null and entry_id=$1 order by created_at asc', [
    entryId,
  ]);
  const entry = entryRes.rows[0];
  const entryAuthor = await getAuthor(entry.user_id);
  const viewers = await viewerMapFor(auth.sub, [entryId]);
  const quote = await quoteEmbedFor(auth, entry.quote_entry_id, purge.active, blocked, blockedBy);
  const replyViewer = await viewerMapForReplies(
    auth.sub,
    replies.rows.map((r: any) => r.id).filter(Boolean),
  );
  const repHydrated = await Promise.all(
    replies.rows.map(async (r) => ({
      ...r,
      author: await getAuthor(r.user_id),
      viewer: replyViewer.get(r.id) ?? { liked: false, reposted: false, bookmarked: false },
    })),
  );
  return {
    entry: {
      ...entry,
      media: entry.media ?? [],
      ai_assisted: Boolean(entry.ai_assisted),
      author: entryAuthor,
      quote,
      viewer: viewers.get(entryId) ?? { liked: false, reposted: false, bookmarked: false },
    },
    replies: repHydrated,
    purge_active: purge.active,
  };
});

// Compatibility alias (mobile client previously used /discourse/thread/:id)
app.get('/thread/:id', async (request, reply) => {
  const id = (request.params as any).id as string;
  return app.inject({
    method: 'GET',
    url: `/entries/${id}/thread`,
    headers: request.headers as any,
  }).then((res) => {
    reply.status(res.statusCode);
    return res.json();
  });
});

// Content detail view (used by mobile ContentDetail)
app.get('/content/:id', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const id = (request.params as any).id as string;
  const entryRes = await pool.query('select * from entries where id=$1', [id]);
  if (entryRes.rowCount === 0) {
    reply.status(404);
    return { error: 'not found' };
  }
  const entry = entryRes.rows[0];
  if (entry.deleted_at) {
    return { removed: true };
  }
  const { blocked, blockedBy } = await getBlockedGraph(auth.sub);
  if (blocked.has(entry.user_id) || blockedBy.has(entry.user_id)) {
    reply.status(403);
    return { blocked: true, reason: 'User blocked' };
  }
  const purge = await getPurgeStatus();
  if (!purge.active && entry.generation !== auth.generation) {
    reply.status(403);
    return { blocked: true, reason: 'Cross-Trybe visibility is blocked while The Gathering is inactive.' };
  }
  const author = await getAuthor(entry.user_id);
  const viewers = await viewerMapFor(auth.sub, [entry.id]);
  const quote = await quoteEmbedFor(auth, entry.quote_entry_id, purge.active, blocked, blockedBy);
  return {
    id: entry.id,
    title: 'Post',
    body: entry.body,
    author: author?.display_name ?? author?.handle ?? 'Unknown',
    timestamp: entry.created_at,
    metadata: entry.topic ? `Topic: ${entry.topic}` : undefined,
    media: entry.media ?? [],
    ai_assisted: Boolean(entry.ai_assisted),
    quote,
    entry: {
      ...entry,
      media: entry.media ?? [],
      ai_assisted: Boolean(entry.ai_assisted),
      author,
      quote,
      viewer: viewers.get(entry.id) ?? { liked: false, reposted: false, bookmarked: false },
    },
  };
});

// My feed (profile timeline)
app.get('/my-feed', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const rows = await pool.query('select * from entries where deleted_at is null and user_id=$1 order by created_at desc limit 50', [
    auth.sub,
  ]);
  const viewers = await viewerMapFor(auth.sub, rows.rows.map((r: any) => r.id));
  const { blocked, blockedBy } = await getBlockedGraph(auth.sub);
  const purge = await getPurgeStatus();
  const hydrated = await Promise.all(
    rows.rows.map(async (r) => ({
      ...r,
      media: r.media ?? [],
      ai_assisted: Boolean(r.ai_assisted),
      author: await getAuthor(r.user_id),
      quote: await quoteEmbedFor(auth, r.quote_entry_id, purge.active, blocked, blockedBy),
      viewer: viewers.get(r.id) ?? { liked: false, reposted: false, bookmarked: false },
    })),
  );
  return { feed: hydrated, restricted: false };
});

app.get('/my-media', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const rows = await pool.query(
    `select * from entries
     where deleted_at is null and user_id=$1
       and jsonb_array_length(coalesce(media,'[]'::jsonb)) > 0
     order by created_at desc limit 50`,
    [auth.sub],
  );
  const viewers = await viewerMapFor(auth.sub, rows.rows.map((r: any) => r.id));
  const { blocked, blockedBy } = await getBlockedGraph(auth.sub);
  const purge = await getPurgeStatus();
  const hydrated = await Promise.all(
    rows.rows.map(async (r) => ({
      ...r,
      media: r.media ?? [],
      ai_assisted: Boolean(r.ai_assisted),
      author: await getAuthor(r.user_id),
      quote: await quoteEmbedFor(auth, r.quote_entry_id, purge.active, blocked, blockedBy),
      viewer: viewers.get(r.id) ?? { liked: false, reposted: false, bookmarked: false },
    })),
  );
  return { feed: hydrated };
});

app.get('/my-replies', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const purge = await getPurgeStatus();
  const { blocked, blockedBy } = await getBlockedGraph(auth.sub);
  const rows = await pool.query(
    `select r.*, e.user_id as entry_user_id, e.generation as entry_generation, e.deleted_at as entry_deleted_at
     from replies r
     join entries e on e.id = r.entry_id
     where r.user_id=$1
       and e.deleted_at is null
     order by r.created_at desc limit 50`,
    [auth.sub],
  );
  const replyViewer = await viewerMapForReplies(auth.sub, rows.rows.map((r: any) => r.id));
  const items = await Promise.all(
    rows.rows.map(async (r: any) => {
      if (!purge.active && r.entry_generation !== auth.generation) return null;
      if (blocked.has(r.entry_user_id) || blockedBy.has(r.entry_user_id)) return null;
      const quote = await quoteEmbedFor(auth, r.entry_id, purge.active, blocked, blockedBy);
      return {
        id: r.id,
        body: r.body,
        created_at: r.created_at,
        generation: r.generation,
        entry_id: r.entry_id,
        author: await getAuthor(r.user_id),
        quote,
        like_count: r.like_count,
        repost_count: r.repost_count,
        bookmark_count: r.bookmark_count,
        viewer: replyViewer.get(r.id) ?? { liked: false, reposted: false, bookmarked: false },
      };
    }),
  );
  return { feed: items.filter(Boolean) };
});

// Public user feed (by handle) used by other-user profile
app.get('/user/:handle/feed', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const handle = (request.params as any).handle as string;
  const uRes = await fetch(`${identityUrl}/public/${encodeURIComponent(handle)}`, {
    headers: { authorization: request.headers.authorization as string },
  });
  if (!uRes.ok) {
    reply.status(404);
    return { error: 'not found' };
  }
  const json: any = await uRes.json();
  const userId = json?.user?.id;
  if (!userId) {
    reply.status(404);
    return { error: 'not found' };
  }
  const purge = await getPurgeStatus();
  const rows = await pool.query('select * from entries where deleted_at is null and user_id=$1 order by created_at desc limit 50', [
    userId,
  ]);
  // In Tribal mode, we still allow viewing public profiles but filter cross-gen posts unless gathering is active.
  const filtered = purge.active ? rows.rows : rows.rows.filter((r) => r.generation === auth.generation);
  const viewers = await viewerMapFor(auth.sub, filtered.map((r: any) => r.id));
  const { blocked, blockedBy } = await getBlockedGraph(auth.sub);
  const hydrated = await Promise.all(
    filtered.map(async (r) => ({
      ...r,
      media: r.media ?? [],
      ai_assisted: Boolean(r.ai_assisted),
      author: await getAuthor(r.user_id),
      quote: await quoteEmbedFor(auth, r.quote_entry_id, purge.active, blocked, blockedBy),
      viewer: viewers.get(r.id) ?? { liked: false, reposted: false, bookmarked: false },
    })),
  );
  const safe = hydrated.filter((e: any) => !(blocked.has(e.user_id) || blockedBy.has(e.user_id)));
  return { feed: safe, restricted: false };
});

app.delete('/entries/:id', async (request, reply) => {
  const auth = getAuth(request);
  if (!auth || !auth.generation || !auth.verified) {
    reply.status(401);
    return { error: 'unauthorized' };
  }
  const ended = await maybeRejectGatheringEnded(request, reply);
  if (ended) return ended;
  const entryId = (request.params as any)['id'] as string;
  const entryRes = await pool.query('select id, user_id, deleted_at from entries where id=$1', [entryId]);
  if (entryRes.rowCount === 0) {
    reply.status(404);
    return { error: 'not found' };
  }
  const entry = entryRes.rows[0];
  if (entry.deleted_at) return { ok: true, removed: true };
  if (entry.user_id !== auth.sub) {
    reply.status(403);
    return { error: 'forbidden' };
  }
  await pool.query('update entries set deleted_at=now() where id=$1', [entryId]);
  await pool.query('delete from timeline_items where entry_id=$1', [entryId]);
  await pool.query('delete from entry_interactions where entry_id=$1', [entryId]);
  const correlationId = request.headers['x-correlation-id'] as string | undefined;
  await appendEvent(
    'discourse.entry_deleted',
    { entry_id: entryId },
    auth.sub,
    auth.generation as GenerationCohort,
    correlationId,
  );
  return { ok: true };
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

app.get('/materializer/status', async (_req, _reply) => {
  const res = await pool.query('select max(created_at) as last_item from timeline_items');
  return { ok: true, last_item: res.rows[0]?.last_item ?? null };
});

setInterval(() => {
  dispatchOutbox(pool, async (topic, payload) => publishEvent(topic, payload));
}, 10000);

setInterval(() => {
  // Best-effort local media job runner; safe to skip if DB is unavailable.
  processMediaJobsOnce().catch(() => {});
}, 2000);

app.get('/internal/entries/:id', async (request, reply) => {
  if (!request.headers['x-internal-call']) {
    reply.status(401);
    return { error: 'internal only' };
  }
  const entryId = (request.params as any)['id'];
  const res = await pool.query('select * from entries where id=$1', [entryId]);
  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'not found' };
  }
  return { entry: res.rows[0] };
});

const start = async () => {
  const port = Number(process.env.PORT ?? 4002);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`discourse running on ${port}`);
};

start().catch((err) => {
  app.log.error(err, 'failed to start discourse');
  process.exit(1);
});

