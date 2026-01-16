#!/usr/bin/env tsx
/**
 * Quick health check for all services
 * Usage: pnpm exec tsx scripts/healthcheck.ts
 */

const SERVICES = [
  { name: 'gateway', port: 4000 },
  { name: 'identity', port: 4001 },
  { name: 'discourse', port: 4002 },
  { name: 'purge', port: 4003 },
  { name: 'cred', port: 4004 },
  { name: 'endorse', port: 4005 },
  { name: 'notes', port: 4006 },
  { name: 'trustgraph', port: 4007 },
  { name: 'safety', port: 4008 },
  { name: 'notifications', port: 4009 },
  { name: 'search', port: 4010 },
  { name: 'messaging', port: 4011 },
  { name: 'lists', port: 4012 },
  { name: 'ops-gateway', port: 4013 },
  { name: 'ops-agents', port: 4014 },
  { name: 'insights', port: 4015 },
  { name: 'ai', port: 4016 },
  { name: 'agents', port: 4017 },
  { name: 'ox-read', port: 4018 },
];

async function checkHealth(name: string, port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('Checking service health...\n');

  const results = await Promise.all(
    SERVICES.map(async ({ name, port }) => {
      const ok = await checkHealth(name, port);
      return { name, port, ok };
    })
  );

  let allOk = true;
  for (const { name, port, ok } of results) {
    const status = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    console.log(`${status} ${name.padEnd(15)} :${port}`);
    if (!ok) allOk = false;
  }

  console.log('');
  if (allOk) {
    console.log('\x1b[32mAll services healthy!\x1b[0m');
    process.exit(0);
  } else {
    console.log('\x1b[33mSome services not responding. Run `make dev` to start them.\x1b[0m');
    process.exit(1);
  }
}

main();
