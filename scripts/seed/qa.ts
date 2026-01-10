/* eslint-disable no-console */
import crypto from 'crypto';
import { execSync } from 'child_process';

const env = (key: string, fallback: string) => process.env[key] || fallback;

const IDENTITY_URL = env('IDENTITY_URL', 'http://localhost:4001');
const DISCOURSE_URL = env('DISCOURSE_URL', 'http://localhost:4002');
const PURGE_URL = env('PURGE_URL', 'http://localhost:4003');

const rand = () => crypto.randomUUID();

// 1x1 PNG (opaque) for deterministic media uploads in dev.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/P7OBxQAAAABJRU5ErkJggg==';

type ReqOpts = {
  token?: string;
  body?: unknown;
  idempotencyKey?: string;
  method?: string;
  deviceId?: string;
};

const request = async (url: string, opts: ReqOpts = {}) => {
  const correlationId = rand();
  const headers: Record<string, string> = {
    'x-correlation-id': correlationId,
    'content-type': 'application/json',
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers['x-idempotency-key'] = opts.idempotencyKey;
  if (opts.deviceId) headers['x-device-id'] = opts.deviceId;
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

const isHealthy = async (url: string) => {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
};

const ensureCoreStack = async () => {
  const ok =
    (await isHealthy(`${IDENTITY_URL}/readyz`)) &&
    (await isHealthy(`${DISCOURSE_URL}/readyz`)) &&
    (await isHealthy(`${PURGE_URL}/readyz`));
  if (ok) return;
  console.log('Starting core stack via pnpm core:up ...');
  execSync('pnpm core:up', { stdio: 'inherit' });
};

async function main() {
  await ensureCoreStack();

  // Ensure Tribal mode for predictable QA starting state.
  await request(`${PURGE_URL}/purge/reset`, { method: 'POST', body: {}, deviceId: 'qa-seed' } as any).catch(() => {});

  const count = Number(process.env.QA_USERS ?? 5);
  const password = process.env.QA_PASSWORD ?? 'Password123!';
  const prefix = process.env.QA_PREFIX ?? `qa_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

  console.log(`Seeding ${count} QA users (prefix=${prefix})…`);

  const users: Array<{ handle: string; token: string }> = [];

  for (let i = 1; i <= count; i++) {
    const handle = `${prefix}_u${i}`;
    const deviceId = `seed-${handle}-${rand().slice(0, 8)}`;

    const reg = await request(`${IDENTITY_URL}/auth/register`, {
      body: { handle, password },
      idempotencyKey: rand(),
      deviceId,
    });
    // Some stacks return 500 on unique violations; treat it as "already exists" for repeatable seeding.
    const already =
      reg.res.status === 409 ||
      (reg.res.status >= 500 && (String(reg.json?.code ?? '').includes('23505') || String(reg.json?.message ?? '').includes('duplicate')));
    if (!reg.res.ok && !already) {
      console.log(`WARN: register ${handle} -> ${reg.res.status}`, reg.json);
    }

    const login = await request(`${IDENTITY_URL}/auth/login`, {
      body: { handle, password },
      deviceId,
    });
    const token = login.json?.access_token as string | undefined;
    if (!token) throw new Error(`login failed for ${handle}: ${login.res.status} ${JSON.stringify(login.json)}`);

    // Verify (required for discourse + media upload-url)
    const gens = ['genz', 'millennial', 'genx', 'boomer'] as const;
    const generation = gens[(i - 1) % gens.length];
    const verify = await request(`${IDENTITY_URL}/verify/ageband`, { token, body: { generation } });
    if (!verify.res.ok) {
      console.log(`WARN: verify ${handle} -> ${verify.res.status}`, verify.json);
    }

    // Re-login to carry verified flag in token
    const login2 = await request(`${IDENTITY_URL}/auth/login`, { body: { handle, password }, deviceId });
    const token2 = login2.json?.access_token as string | undefined;
    if (!token2) throw new Error(`relogin failed for ${handle}`);

    users.push({ handle, token: token2 });
  }

  // Create a second session for user 1 to test sessions UI
  const first = users[0];
  if (first) {
    await request(`${IDENTITY_URL}/auth/login`, {
      body: { handle: first.handle, password },
      deviceId: `seed-${first.handle}-second-${rand().slice(0, 8)}`,
    });
  }

  // Seed posts with media
  for (const u of users) {
    // A) text-only
    await request(`${DISCOURSE_URL}/entries`, {
      token: u.token,
      idempotencyKey: rand(),
      body: {
        assumption_type: 'lived_experience',
        content: `QA text-only by @${u.handle} (${new Date().toISOString()})`,
        topic: 'qa',
        ai_assisted: false,
        media: [],
      },
    }).catch(() => {});

    // B) single image
    const plan1 = await request(`${DISCOURSE_URL}/media/upload-url`, { token: u.token, body: { type: 'image' } });
    const id1 = plan1.json?.upload?.id as string | undefined;
    const url1 = plan1.json?.upload?.public_url as string | undefined;
    if (id1) {
      await request(`${DISCOURSE_URL}/media/upload`, {
        token: u.token,
        body: { id: id1, filename: 'qa.png', content_type: 'image/png', data_base64: TINY_PNG_BASE64 },
      });
    }

    // C) multi-image + AI assisted flag
    const mediaArr: any[] = [];
    if (url1) mediaArr.push({ url: url1, type: 'image' });
    for (let j = 0; j < 2; j++) {
      const planN = await request(`${DISCOURSE_URL}/media/upload-url`, { token: u.token, body: { type: 'image' } });
      const idN = planN.json?.upload?.id as string | undefined;
      const urlN = planN.json?.upload?.public_url as string | undefined;
      if (idN) {
        await request(`${DISCOURSE_URL}/media/upload`, {
          token: u.token,
          body: { id: idN, filename: `qa_${j}.png`, content_type: 'image/png', data_base64: TINY_PNG_BASE64 },
        });
      }
      if (urlN) mediaArr.push({ url: urlN, type: 'image' });
    }

    const entry = await request(`${DISCOURSE_URL}/entries`, {
      token: u.token,
      idempotencyKey: rand(),
      body: {
        assumption_type: 'lived_experience',
        content: `QA media post by @${u.handle} — multi-image (${new Date().toISOString()})`,
        topic: 'qa',
        ai_assisted: u.handle.endsWith('1') || u.handle.endsWith('3'),
        media: mediaArr,
      },
    });
    if (!entry.res.ok) console.log(`WARN: entry create ${u.handle} -> ${entry.res.status}`, entry.json);
  }

  console.log('\nQA credentials (use these in the app Login):');
  for (const u of users) console.log(`- ${u.handle} / ${password}`);
  console.log('\nNotes:');
  console.log('- All users are verified (ageband) so media endpoints work.');
  console.log('- Topic seeded: #qa');
  console.log('- User 1 has 2 sessions (test Sessions list + revoke).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


