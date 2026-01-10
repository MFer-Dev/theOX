import assert from 'assert';

const apiBase = process.env.API_BASE_URL || 'http://localhost:4000';
const token = process.env.MOBILE_TOKEN || '';
const smokeDown = process.env.SMOKE_DOWN === '1';

const fetchJson = async (path: string, opts: RequestInit = {}) => {
  const res = await fetch(`${apiBase}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  return { ok: res.ok, status: res.status, json: res.ok ? await res.json() : null };
};

const main = async () => {
  const results: Record<string, boolean> = {};

  const health = await fetchJson('/healthz');
  results.health = health.ok;

  if (token) {
    const me = await fetchJson('/identity/me', { headers: { Authorization: `Bearer ${token}` } });
    results.me = me.ok;

    const feed = await fetchJson('/discourse/feed', { headers: { Authorization: `Bearer ${token}` } });
    results.feed = feed.ok;

    const defaultContentId = '00000000-0000-0000-0000-000000000000';
    const notes = await fetchJson(`/notes/by-content/${defaultContentId}`, { headers: { Authorization: `Bearer ${token}` } });
    results.notes = notes.ok || notes.status === 404; // allow empty

    const safety = await fetchJson('/safety/my-status', { headers: { Authorization: `Bearer ${token}` } });
    results.safety = safety.ok || safety.status === 404; // optional until implemented
  }

  if (!smokeDown) {
    assert(results.health, 'health failed');
  }
  console.log('mobile-contract smoke:', results);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

