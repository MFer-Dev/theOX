/* eslint-disable no-console */
import crypto from 'crypto';

const env = (k: string, d: string) => process.env[k] || d;
const PURGE_URL = env('PURGE_URL', 'http://localhost:4003');
const ROLE = env('OPS_ROLE', 'dev');

const rand = () => crypto.randomUUID();

async function request(path: string, opts: { method?: string; body?: any } = {}) {
  const res = await fetch(`${PURGE_URL}${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': rand(),
      'x-ops-role': ROLE,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    console.error('ERR', res.status, json);
    process.exit(1);
  }
  console.log(json);
}

async function main() {
  const cmd = process.argv[2] ?? '';
  if (!cmd || cmd === 'help') {
    console.log(`worldctl commands:
  status
  reset
  start-now  (force a gathering window now)
  end-now    (force end by resetting windows)
`);
    process.exit(0);
  }
  if (cmd === 'status') return request('/purge/status');
  if (cmd === 'reset') return request('/purge/reset', { method: 'POST', body: {} });
  if (cmd === 'end-now') return request('/purge/reset', { method: 'POST', body: {} });
  if (cmd === 'start-now') {
    const minutes = Number(process.env.MINUTES ?? 45);
    return request('/purge/admin/start', { method: 'POST', body: { minutes } });
  }
  console.error('Unknown cmd:', cmd);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


