/* eslint-disable no-console */
/**
 * Seed Watchable - Create a Populated Arena in 2 Minutes
 *
 * This script creates enough activity to make the OX Arena watchable:
 * - 10-15 agents across deployments
 * - Sponsorship pressures and allocations
 * - Multiple sessions with varying dynamics
 * - Artifacts including perceptions (critiques, counter-models)
 * - At least 1 conflict chain or wave
 * - 100+ chronicle entries
 *
 * Usage: pnpm exec tsx scripts/seed/watchable.ts
 *        OR: make seed-watchable
 *
 * This is for LOCAL DEMO ONLY.
 */

import * as crypto from 'crypto';

const env = (key: string, fallback: string) => process.env[key] || fallback;

const AGENTS_URL = env('AGENTS_URL', 'http://localhost:4017');
const OX_READ_URL = env('OX_READ_URL', 'http://localhost:4018');
const OX_PHYSICS_URL = env('OX_PHYSICS_URL', 'http://localhost:4019');

// Deterministic seed for reproducibility
const SEED_PREFIX = 'ox_watchable_v1';

const deterministicId = (name: string): string => {
  return crypto.createHash('sha256').update(`${SEED_PREFIX}:${name}`).digest('hex').slice(0, 32);
};

const rand = () => crypto.randomUUID();

// Helpful delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type ReqOpts = {
  body?: unknown;
  method?: string;
  headers?: Record<string, string>;
};

const request = async (url: string, opts: ReqOpts = {}): Promise<{ res: Response; json: unknown }> => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-correlation-id': rand(),
    ...opts.headers,
  };
  const res = await fetch(url, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { res, json };
};

const isHealthy = async (url: string): Promise<boolean> => {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
};

// ============================================================================
// Agent definitions - enough for interesting dynamics
// ============================================================================

const DEPLOYMENT_TARGETS = ['ox-sandbox', 'ox-lab'] as const;

const AGENT_PERSONAS = [
  // Sandbox agents - more active
  { handle: 'alpha', deployment: 'ox-sandbox', balance: 200, style: 'creator' },
  { handle: 'beta', deployment: 'ox-sandbox', balance: 150, style: 'communicator' },
  { handle: 'gamma', deployment: 'ox-sandbox', balance: 180, style: 'critic' },
  { handle: 'delta', deployment: 'ox-sandbox', balance: 120, style: 'provocateur' },
  { handle: 'epsilon', deployment: 'ox-sandbox', balance: 160, style: 'creator' },
  { handle: 'zeta', deployment: 'ox-sandbox', balance: 140, style: 'communicator' },
  { handle: 'eta', deployment: 'ox-sandbox', balance: 130, style: 'critic' },
  // Lab agents - less active
  { handle: 'theta', deployment: 'ox-lab', balance: 100, style: 'creator' },
  { handle: 'iota', deployment: 'ox-lab', balance: 80, style: 'provocateur' },
  { handle: 'kappa', deployment: 'ox-lab', balance: 90, style: 'communicator' },
  { handle: 'lambda', deployment: 'ox-lab', balance: 70, style: 'critic' },
  { handle: 'mu', deployment: 'ox-lab', balance: 85, style: 'creator' },
] as const;

// Action sequences that create interesting narratives
const ACTION_SEQUENCES = {
  discussion: ['communicate', 'communicate', 'create', 'communicate'],
  debate: ['communicate', 'critique', 'counter_model', 'communicate', 'refusal'],
  collaboration: ['associate', 'create', 'create', 'exchange'],
  conflict: ['communicate', 'critique', 'conflict', 'conflict', 'withdraw'],
  creation_burst: ['create', 'create', 'create', 'exchange'],
} as const;

// ============================================================================
// Seed functions
// ============================================================================

let createdAgentIds: Map<string, string> = new Map();
let stats = {
  agents: 0,
  actions: { total: 0, accepted: 0 },
  sessions: 0,
  artifacts: 0,
  conflicts: 0,
  waves: 0,
};

async function ensureServicesHealthy(): Promise<void> {
  console.log('[1/8] Checking service health...');

  const checks = await Promise.all([
    isHealthy(`${AGENTS_URL}/healthz`),
    isHealthy(`${OX_READ_URL}/healthz`),
    isHealthy(`${OX_PHYSICS_URL}/healthz`),
  ]);

  if (!checks[0]) throw new Error(`Agents service not healthy at ${AGENTS_URL}`);
  if (!checks[1]) throw new Error(`OX Read service not healthy at ${OX_READ_URL}`);
  if (!checks[2]) throw new Error(`OX Physics service not healthy at ${OX_PHYSICS_URL}`);

  console.log('  All services healthy.');
}

async function seedAgents(): Promise<void> {
  console.log('[2/8] Creating agents...');

  for (const agent of AGENT_PERSONAS) {
    const idempotencyKey = deterministicId(`agent:${agent.handle}`);

    const { res, json } = await request(`${AGENTS_URL}/agents`, {
      body: {
        handle: agent.handle,
        deployment_target: agent.deployment,
        capacity: {
          initial_balance: agent.balance,
          max_balance: agent.balance,
          regen_per_hour: 20,
        },
      },
      headers: { 'x-idempotency-key': idempotencyKey },
    });

    const data = json as { agent?: { id: string }; id?: string };
    let agentId = data?.agent?.id || data?.id;

    if (res.ok && agentId) {
      createdAgentIds.set(agent.handle, agentId);
      stats.agents++;
      console.log(`  Created agent ${agent.handle}: ${agentId.slice(0, 8)}...`);
    } else if (res.status === 409 || res.status === 200) {
      // Already exists, try to fetch
      const listRes = await request(`${AGENTS_URL}/agents?handle=${agent.handle}`);
      const listData = listRes.json as { agents?: Array<{ id: string; handle: string }> };
      const existing = listData?.agents?.find((a) => a.handle === agent.handle);
      if (existing) {
        createdAgentIds.set(agent.handle, existing.id);
        console.log(`  Agent ${agent.handle} exists: ${existing.id.slice(0, 8)}...`);
      }
    }
  }

  console.log(`  Total: ${createdAgentIds.size} agents`);
}

async function setEnvironmentConstraints(): Promise<void> {
  console.log('[3/8] Setting environment constraints...');

  // Set sandbox to have interesting dynamics
  await request(`${AGENTS_URL}/admin/environment/ox-sandbox`, {
    method: 'PUT',
    body: {
      deployment_target: 'ox-sandbox',
      cognition_availability: 'full',
      max_throughput_per_minute: 500,
      throttle_factor: 1.0,
      reason: 'Watchable seed environment',
    },
    headers: { 'x-ops-role': 'seed' },
  });

  // Set lab to be quieter
  await request(`${AGENTS_URL}/admin/environment/ox-lab`, {
    method: 'PUT',
    body: {
      deployment_target: 'ox-lab',
      cognition_availability: 'full',
      max_throughput_per_minute: 200,
      throttle_factor: 1.2,
      reason: 'Watchable seed environment (lab)',
    },
    headers: { 'x-ops-role': 'seed' },
  });

  console.log('  Environment constraints set.');
}

async function triggerPhysics(): Promise<void> {
  console.log('[4/8] Triggering physics...');

  // Apply regimes
  for (const target of DEPLOYMENT_TARGETS) {
    const regime = target === 'ox-sandbox' ? 'clear' : 'fog';
    await request(`${OX_PHYSICS_URL}/deployments/${target}/apply-regime`, {
      body: { regime_name: regime },
      headers: { 'x-ops-role': 'seed' },
    });
    console.log(`  Applied ${regime} regime to ${target}`);
  }

  // Trigger physics ticks
  for (const target of DEPLOYMENT_TARGETS) {
    await request(`${OX_PHYSICS_URL}/deployments/${target}/tick`, {
      headers: { 'x-ops-role': 'seed' },
    });
  }

  console.log('  Physics ticks triggered.');
}

async function executeAction(agentHandle: string, actionType: string, subjectHandle?: string): Promise<boolean> {
  const agentId = createdAgentIds.get(agentHandle);
  if (!agentId) return false;

  const subjectId = subjectHandle ? createdAgentIds.get(subjectHandle) : undefined;
  const idempotencyKey = deterministicId(`action:${agentHandle}:${stats.actions.total}`);

  const payload: Record<string, unknown> = {
    action_type: actionType,
    requested_cost: Math.floor(Math.random() * 5) + 1,
    idempotency_key: idempotencyKey,
    payload: {
      seed: true,
      sequence: stats.actions.total,
      narrative: `${agentHandle} performs ${actionType}`,
    },
  };

  if (subjectId) {
    payload.subject_agent_id = subjectId;
    payload.payload = {
      ...payload.payload as Record<string, unknown>,
      subject_handle: subjectHandle,
    };
  }

  const { res, json } = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, { body: payload });

  stats.actions.total++;
  const data = json as { accepted?: boolean };
  if (res.ok && data?.accepted) {
    stats.actions.accepted++;
    return true;
  }
  return false;
}

async function generateActivity(): Promise<void> {
  console.log('[5/8] Generating activity...');

  const sandboxAgents = AGENT_PERSONAS.filter(a => a.deployment === 'ox-sandbox').map(a => a.handle);
  const labAgents = AGENT_PERSONAS.filter(a => a.deployment === 'ox-lab').map(a => a.handle);

  // Run multiple narrative sequences in sandbox
  const sequences = Object.entries(ACTION_SEQUENCES);

  for (let round = 0; round < 5; round++) {
    console.log(`  Round ${round + 1}/5...`);

    // Pick a random sequence and pair of agents
    for (let i = 0; i < sandboxAgents.length - 1; i += 2) {
      const [seqName, actions] = sequences[round % sequences.length];
      const agent1 = sandboxAgents[i];
      const agent2 = sandboxAgents[i + 1];

      for (const action of actions) {
        // Alternate between agents
        const acting = Math.random() > 0.5 ? agent1 : agent2;
        const subject = acting === agent1 ? agent2 : agent1;

        const needsSubject = ['critique', 'counter_model', 'refusal', 'rederivation', 'conflict'].includes(action);
        await executeAction(acting, action, needsSubject ? subject : undefined);

        // Small delay to spread events
        await delay(50);
      }
    }

    // Some activity in lab too
    for (const agent of labAgents) {
      await executeAction(agent, 'communicate');
      await executeAction(agent, 'create');
    }

    await delay(100);
  }

  // Extra burst of conflict to ensure we have conflict chains
  console.log('  Generating conflict burst...');
  for (let i = 0; i < 3; i++) {
    const [a1, a2] = [sandboxAgents[i % sandboxAgents.length], sandboxAgents[(i + 1) % sandboxAgents.length]];
    await executeAction(a1, 'conflict', a2);
    await executeAction(a2, 'conflict', a1);
    await executeAction(a1, 'conflict', a2);
    await delay(50);
  }

  // Creation burst to ensure artifacts
  console.log('  Generating artifact burst...');
  for (const agent of sandboxAgents.slice(0, 4)) {
    for (let j = 0; j < 3; j++) {
      await executeAction(agent, 'create');
      await delay(20);
    }
  }

  console.log(`  Actions: ${stats.actions.accepted}/${stats.actions.total} accepted`);
}

async function generatePerceptionArtifacts(): Promise<void> {
  console.log('[6/8] Generating perception artifacts...');

  const sandboxAgents = AGENT_PERSONAS.filter(a => a.deployment === 'ox-sandbox').map(a => a.handle);
  const perceptionTypes = ['critique', 'counter_model', 'refusal', 'rederivation'] as const;

  // Each agent creates perceptions about others
  for (let i = 0; i < sandboxAgents.length; i++) {
    const issuer = sandboxAgents[i];
    const subject = sandboxAgents[(i + 1) % sandboxAgents.length];

    for (let j = 0; j < 2; j++) {
      const pType = perceptionTypes[(i + j) % perceptionTypes.length];
      await executeAction(issuer, pType, subject);
      stats.artifacts++;
    }
  }

  console.log(`  Created ${stats.artifacts} perception artifacts`);
}

async function triggerPostActivityPhysics(): Promise<void> {
  console.log('[7/8] Post-activity physics processing...');

  // Trigger multiple physics ticks to process events
  for (let i = 0; i < 3; i++) {
    for (const target of DEPLOYMENT_TARGETS) {
      await request(`${OX_PHYSICS_URL}/deployments/${target}/tick`, {
        headers: { 'x-ops-role': 'seed' },
      });
    }
    await delay(500);
  }

  console.log('  Physics processed.');
}

async function verifyWatchability(): Promise<void> {
  console.log('[8/8] Verifying watchability...');

  // Wait for projections to materialize
  await delay(2000);

  // Check chronicle
  const chronicleRes = await request(`${OX_READ_URL}/ox/chronicle?deployment=ox-sandbox&limit=100`);
  const chronicle = chronicleRes.json as Array<{ ts: string; text: string }>;
  const chronicleCount = Array.isArray(chronicle) ? chronicle.length : 0;

  // Check sessions
  const sessionsRes = await request(`${OX_READ_URL}/ox/sessions?limit=50`);
  const sessions = (sessionsRes.json as { sessions?: unknown[] })?.sessions || [];
  stats.sessions = sessions.length;

  // Check conflict chains
  const conflictsRes = await request(`${OX_READ_URL}/ox/deployments/ox-sandbox/conflict-chains?limit=10`);
  const conflicts = (conflictsRes.json as { conflict_chains?: unknown[] })?.conflict_chains || [];
  stats.conflicts = conflicts.length;

  // Check waves
  const wavesRes = await request(`${OX_READ_URL}/ox/deployments/ox-sandbox/waves?limit=10`);
  const waves = (wavesRes.json as { waves?: unknown[] })?.waves || [];
  stats.waves = waves.length;

  console.log('\n' + '='.repeat(50));
  console.log('WATCHABILITY CHECK');
  console.log('='.repeat(50));
  console.log(`Chronicle entries: ${chronicleCount} ${chronicleCount >= 50 ? '' : ''}`);
  console.log(`Sessions: ${stats.sessions} ${stats.sessions >= 5 ? '' : ''}`);
  console.log(`Conflict chains: ${stats.conflicts} ${stats.conflicts >= 1 ? '' : ''}`);
  console.log(`Waves: ${stats.waves}`);
  console.log(`Agents: ${stats.agents}`);
  console.log(`Actions accepted: ${stats.actions.accepted}/${stats.actions.total}`);

  const ready = chronicleCount >= 30 && stats.sessions >= 3;
  console.log('\n' + (ready ? 'Arena is WATCHABLE' : 'Arena needs more activity'));
  console.log('\nOpen http://localhost:3001/arena to view');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('='.repeat(50));
  console.log('OX WATCHABLE SEED');
  console.log('Creating a populated arena for local demo');
  console.log('='.repeat(50));
  console.log('');

  const start = Date.now();

  try {
    await ensureServicesHealthy();
    await seedAgents();
    await setEnvironmentConstraints();
    await triggerPhysics();
    await generateActivity();
    await generatePerceptionArtifacts();
    await triggerPostActivityPhysics();
    await verifyWatchability();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\nCompleted in ${elapsed}s`);

  } catch (err) {
    console.error('\nSEED FAILED:', err);
    process.exit(1);
  }
}

main();
