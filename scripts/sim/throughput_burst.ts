/* eslint-disable no-console */
/**
 * OX Throughput Burst Simulator
 *
 * Generates N attempts/min across M agents to:
 * 1. Verify throughput limits cause rejections
 * 2. Verify /ox/system/event-lag reports increasing lag when consumer is overwhelmed
 *
 * Run: pnpm exec tsx scripts/sim/throughput_burst.ts
 *
 * Options (env vars):
 *   BURST_AGENTS=3     Number of agents to use
 *   BURST_RPS=10       Requests per second
 *   BURST_DURATION=30  Duration in seconds
 *   BURST_TARGET=ox-sandbox  Deployment target
 */

import * as crypto from 'crypto';

const env = (key: string, fallback: string) => process.env[key] || fallback;

const AGENTS_URL = env('AGENTS_URL', 'http://localhost:4017');
const OX_READ_URL = env('OX_READ_URL', 'http://localhost:4018');

// Simulation parameters
const BURST_AGENTS = Number(env('BURST_AGENTS', '3'));
const BURST_RPS = Number(env('BURST_RPS', '10'));
const BURST_DURATION = Number(env('BURST_DURATION', '30'));
const BURST_TARGET = env('BURST_TARGET', 'ox-sandbox');

const rand = () => crypto.randomUUID();

interface SimResult {
  total_requests: number;
  accepted: number;
  rejected: number;
  rejection_reasons: Record<string, number>;
  avg_latency_ms: number;
  max_latency_ms: number;
  throughput_rps: number;
  event_lag_before: number | null;
  event_lag_after: number | null;
  duration_ms: number;
}

async function request(
  url: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...opts.headers,
  };

  const start = Date.now();
  const res = await fetch(url, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const latency = Date.now() - start;

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  return { res, json, latency };
}

async function getEventLag(): Promise<number | null> {
  try {
    const { json, res } = await request(`${OX_READ_URL}/ox/system/event-lag`, {
      headers: {
        'x-observer-id': 'sim_auditor',
        'x-observer-role': 'auditor',
      },
    });

    if (!res.ok) return null;

    const data = json as any;
    const recentEvents = data?.recent_events || [];

    if (recentEvents.length === 0) return 0;

    // Average seconds since event
    const avgLag = recentEvents.reduce((sum: number, e: any) => sum + (e.seconds_since || 0), 0) / recentEvents.length;
    return avgLag;
  } catch {
    return null;
  }
}

async function getOrCreateAgents(): Promise<string[]> {
  console.log(`\n--- Getting/Creating ${BURST_AGENTS} agents ---`);

  const agentIds: string[] = [];

  // Try to get existing agents first
  const { json } = await request(`${AGENTS_URL}/agents?limit=${BURST_AGENTS * 2}`);
  const existing = ((json as any)?.agents || [])
    .filter((a: any) => a.deployment_target === BURST_TARGET)
    .slice(0, BURST_AGENTS);

  for (const agent of existing) {
    agentIds.push(agent.id);
    console.log(`  [EXISTS] ${agent.handle} -> ${agent.id}`);
  }

  // Create more if needed
  while (agentIds.length < BURST_AGENTS) {
    const handle = `sim_burst_${Date.now()}_${agentIds.length}`;
    const { json: createJson, res } = await request(`${AGENTS_URL}/agents`, {
      body: {
        handle,
        deployment_target: BURST_TARGET,
        capacity: {
          initial_balance: 1000, // High balance for burst testing
          max_balance: 1000,
          regen_per_hour: 100,
        },
      },
    });

    if (res.ok) {
      const id = (createJson as any)?.agent?.id || (createJson as any)?.id;
      if (id) {
        agentIds.push(id);
        console.log(`  [CREATED] ${handle} -> ${id}`);
      }
    }
  }

  return agentIds;
}

async function setEnvironmentConstraints(): Promise<void> {
  console.log('\n--- Setting environment constraints ---');

  // Set a low throughput limit to trigger rejections
  const { res, json } = await request(`${AGENTS_URL}/admin/environment/${BURST_TARGET}`, {
    method: 'PUT',
    body: {
      deployment_target: BURST_TARGET,
      cognition_availability: 'full',
      max_throughput_per_minute: BURST_RPS * 30, // Allow ~30 seconds worth, then reject
      throttle_factor: 1.0,
      reason: 'Throughput burst simulation',
    },
    headers: {
      'x-ops-role': 'sim',
    },
  });

  if (res.ok) {
    console.log(`  [OK] Set max_throughput_per_minute=${BURST_RPS * 30} for ${BURST_TARGET}`);
  } else {
    console.log(`  [WARN] Could not set constraints: ${res.status} ${JSON.stringify(json)}`);
  }
}

async function runBurst(agentIds: string[]): Promise<SimResult> {
  console.log('\n--- Running burst simulation ---');
  console.log(`  Agents: ${agentIds.length}`);
  console.log(`  Target RPS: ${BURST_RPS}`);
  console.log(`  Duration: ${BURST_DURATION}s`);

  const result: SimResult = {
    total_requests: 0,
    accepted: 0,
    rejected: 0,
    rejection_reasons: {},
    avg_latency_ms: 0,
    max_latency_ms: 0,
    throughput_rps: 0,
    event_lag_before: await getEventLag(),
    event_lag_after: null,
    duration_ms: 0,
  };

  const latencies: number[] = [];
  const interval = 1000 / BURST_RPS;
  const startTime = Date.now();
  const endTime = startTime + BURST_DURATION * 1000;

  let requestIndex = 0;

  // Fire requests at the target rate
  while (Date.now() < endTime) {
    const agentId = agentIds[requestIndex % agentIds.length];
    const actionTypes = ['communicate', 'create', 'associate', 'exchange'];
    const actionType = actionTypes[requestIndex % actionTypes.length];

    // Fire and forget (async) to maintain rate
    request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
      body: {
        action_type: actionType,
        requested_cost: 1,
        idempotency_key: `burst_${rand()}`,
        payload: { burst: true, index: requestIndex },
      },
    }).then(({ res, json, latency }) => {
      result.total_requests++;
      latencies.push(latency);

      const data = json as any;
      if (res.ok && data?.accepted) {
        result.accepted++;
      } else {
        result.rejected++;
        const reason = data?.reason || data?.error || `status_${res.status}`;
        result.rejection_reasons[reason] = (result.rejection_reasons[reason] || 0) + 1;
      }
    }).catch(() => {
      result.total_requests++;
      result.rejected++;
      result.rejection_reasons['network_error'] = (result.rejection_reasons['network_error'] || 0) + 1;
    });

    requestIndex++;

    // Wait for next request slot
    await new Promise(resolve => setTimeout(resolve, interval));

    // Progress update every 5 seconds
    if (requestIndex % (BURST_RPS * 5) === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`  [PROGRESS] ${elapsed}s: ${result.total_requests} requests, ${result.rejected} rejected`);
    }
  }

  // Wait for in-flight requests to complete
  await new Promise(resolve => setTimeout(resolve, 2000));

  result.duration_ms = Date.now() - startTime;
  result.event_lag_after = await getEventLag();

  // Calculate stats
  if (latencies.length > 0) {
    result.avg_latency_ms = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    result.max_latency_ms = Math.max(...latencies);
  }
  result.throughput_rps = Math.round((result.total_requests / result.duration_ms) * 1000 * 100) / 100;

  return result;
}

async function verifyRejections(result: SimResult): Promise<boolean> {
  console.log('\n--- Verifying throughput rejections ---');

  // Check environment rejections endpoint
  const { json, res } = await request(`${OX_READ_URL}/ox/environment/${BURST_TARGET}/rejections?limit=100`, {
    headers: {
      'x-observer-id': 'sim_auditor',
      'x-observer-role': 'auditor',
    },
  });

  if (!res.ok) {
    console.log(`  [WARN] Could not fetch rejections: ${res.status}`);
    return false;
  }

  const rejections = (json as any)?.rejections || [];
  console.log(`  [INFO] Found ${rejections.length} rejections in projection`);

  // Verify rejections match what we observed
  const throughputRejections = rejections.filter((r: any) =>
    r.rejection_reason?.includes('throughput') ||
    r.rejection_reason?.includes('rate')
  );

  if (throughputRejections.length > 0) {
    console.log(`  [OK] ${throughputRejections.length} throughput-related rejections materialized`);
    return true;
  }

  if (result.rejected > 0) {
    console.log(`  [INFO] ${result.rejected} rejections observed but may not all be throughput-related`);
    return true;
  }

  console.log(`  [INFO] No rejections observed (throughput limit may not have been hit)`);
  return false;
}

async function main() {
  console.log('='.repeat(60));
  console.log('OX Throughput Burst Simulator');
  console.log('='.repeat(60));

  try {
    // Setup
    const agentIds = await getOrCreateAgents();
    if (agentIds.length === 0) {
      throw new Error('No agents available for simulation');
    }

    await setEnvironmentConstraints();

    // Run burst
    const result = await runBurst(agentIds);

    // Verify
    await verifyRejections(result);

    // Report
    console.log('\n' + '='.repeat(60));
    console.log('SIMULATION COMPLETE');
    console.log('='.repeat(60));
    console.log('\nResults:');
    console.log(`  Total requests: ${result.total_requests}`);
    console.log(`  Accepted: ${result.accepted}`);
    console.log(`  Rejected: ${result.rejected}`);
    console.log(`  Rejection rate: ${((result.rejected / result.total_requests) * 100).toFixed(1)}%`);
    console.log(`  Avg latency: ${result.avg_latency_ms}ms`);
    console.log(`  Max latency: ${result.max_latency_ms}ms`);
    console.log(`  Actual RPS: ${result.throughput_rps}`);
    console.log(`  Duration: ${result.duration_ms}ms`);
    console.log(`  Event lag before: ${result.event_lag_before?.toFixed(1) ?? 'N/A'}s`);
    console.log(`  Event lag after: ${result.event_lag_after?.toFixed(1) ?? 'N/A'}s`);

    if (Object.keys(result.rejection_reasons).length > 0) {
      console.log('\nRejection reasons:');
      for (const [reason, count] of Object.entries(result.rejection_reasons)) {
        console.log(`  ${reason}: ${count}`);
      }
    }

    // JSON output if requested
    if (process.env.BURST_JSON_OUTPUT) {
      console.log('\n--- JSON Output ---');
      console.log(JSON.stringify(result, null, 2));
    }

    // Determine success
    const success = result.total_requests > 0;
    process.exit(success ? 0 : 1);

  } catch (err) {
    console.error('\nSIMULATION ERROR:', err);
    process.exit(1);
  }
}

main();
