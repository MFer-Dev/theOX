/* eslint-disable no-console */
/**
 * OX Scenario Seeder
 *
 * Creates a deterministic, idempotent test scenario for the OX system:
 * - 3 observers (viewer, analyst, auditor)
 * - 6 agents across 2 deployment targets
 * - Mix of actions producing: sessions, perception artifacts, environment rejections, drift deltas
 *
 * Run: pnpm exec tsx scripts/seed/ox_scenarios.ts
 */

import * as crypto from 'crypto';

const env = (key: string, fallback: string) => process.env[key] || fallback;

const AGENTS_URL = env('AGENTS_URL', 'http://localhost:4017');
const OX_READ_URL = env('OX_READ_URL', 'http://localhost:4018');

// Deterministic seed prefix for idempotency
const SEED_PREFIX = 'ox_seed_v1';
const rand = () => crypto.randomUUID();

// Deterministic ID generator based on name (for idempotency)
const deterministicId = (name: string): string => {
  return crypto.createHash('sha256').update(`${SEED_PREFIX}:${name}`).digest('hex').slice(0, 32);
};

type ReqOpts = {
  body?: unknown;
  method?: string;
  headers?: Record<string, string>;
};

const request = async (url: string, opts: ReqOpts = {}) => {
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

const isHealthy = async (url: string) => {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
};

// Scenario data definitions
const DEPLOYMENT_TARGETS = ['ox-sandbox', 'ox-lab'] as const;

const OBSERVERS = [
  { id: 'obs_viewer', role: 'viewer', metadata: { source: 'seed' } },
  { id: 'obs_analyst', role: 'analyst', metadata: { source: 'seed', specialty: 'patterns' } },
  { id: 'obs_auditor', role: 'auditor', metadata: { source: 'seed', clearance: 'full' } },
] as const;

const AGENTS = [
  { handle: 'ox_agent_alpha', deployment: 'ox-sandbox', balance: 100 },
  { handle: 'ox_agent_beta', deployment: 'ox-sandbox', balance: 100 },
  { handle: 'ox_agent_gamma', deployment: 'ox-sandbox', balance: 50 },
  { handle: 'ox_agent_delta', deployment: 'ox-lab', balance: 100 },
  { handle: 'ox_agent_epsilon', deployment: 'ox-lab', balance: 75 },
  { handle: 'ox_agent_zeta', deployment: 'ox-lab', balance: 50 },
] as const;

// Result tracking
interface SeedResult {
  observers: Array<{ id: string; role: string }>;
  agents: Array<{ id: string; handle: string; deployment: string }>;
  actions: {
    total: number;
    accepted: number;
    rejected: number;
  };
  perception_artifacts: number;
  environment_constraints_set: string[];
  errors: string[];
}

const result: SeedResult = {
  observers: [],
  agents: [],
  actions: { total: 0, accepted: 0, rejected: 0 },
  perception_artifacts: 0,
  environment_constraints_set: [],
  errors: [],
};

async function ensureServicesHealthy() {
  console.log('Checking service health...');

  const agentsOk = await isHealthy(`${AGENTS_URL}/healthz`);
  const oxReadOk = await isHealthy(`${OX_READ_URL}/healthz`);

  if (!agentsOk) {
    throw new Error(`Agents service not healthy at ${AGENTS_URL}`);
  }
  if (!oxReadOk) {
    throw new Error(`OX Read service not healthy at ${OX_READ_URL}`);
  }

  console.log('Services healthy.');
}

async function seedObservers() {
  console.log('\n--- Seeding Observers ---');

  for (const obs of OBSERVERS) {
    const { res, json } = await request(`${OX_READ_URL}/ox/observers/register`, {
      body: {
        observer_id: obs.id,
        role: obs.role,
        metadata: obs.metadata,
      },
    });

    if (res.ok) {
      result.observers.push({ id: obs.id, role: obs.role });
      console.log(`  [OK] Observer ${obs.id} (${obs.role})`);
    } else {
      const err = `Observer ${obs.id}: ${res.status} ${JSON.stringify(json)}`;
      result.errors.push(err);
      console.log(`  [WARN] ${err}`);
    }
  }
}

async function seedAgents(): Promise<Map<string, string>> {
  console.log('\n--- Seeding Agents ---');

  const handleToId = new Map<string, string>();

  for (const agent of AGENTS) {
    const idempotencyKey = deterministicId(`agent:${agent.handle}`);

    const { res, json } = await request(`${AGENTS_URL}/agents`, {
      body: {
        handle: agent.handle,
        deployment_target: agent.deployment,
        capacity: {
          initial_balance: agent.balance,
          max_balance: agent.balance,
          regen_per_hour: 10,
        },
      },
      headers: {
        'x-idempotency-key': idempotencyKey,
      },
    });

    const data = json as { agent?: { id: string }; id?: string };
    const agentId = data?.agent?.id || data?.id;

    if (res.ok && agentId) {
      handleToId.set(agent.handle, agentId);
      result.agents.push({ id: agentId, handle: agent.handle, deployment: agent.deployment });
      console.log(`  [OK] Agent ${agent.handle} -> ${agentId} (${agent.deployment})`);
    } else if (res.status === 409 || res.status === 200) {
      // Already exists, fetch it
      const listRes = await request(`${AGENTS_URL}/agents?handle=${agent.handle}`);
      const listData = listRes.json as { agents?: Array<{ id: string; handle: string }> };
      const existing = listData?.agents?.find((a) => a.handle === agent.handle);
      if (existing) {
        handleToId.set(agent.handle, existing.id);
        result.agents.push({ id: existing.id, handle: agent.handle, deployment: agent.deployment });
        console.log(`  [EXISTS] Agent ${agent.handle} -> ${existing.id}`);
      }
    } else {
      const err = `Agent ${agent.handle}: ${res.status} ${JSON.stringify(json)}`;
      result.errors.push(err);
      console.log(`  [WARN] ${err}`);
    }
  }

  return handleToId;
}

async function seedActions(handleToId: Map<string, string>) {
  console.log('\n--- Seeding Actions ---');

  const agentIds = Array.from(handleToId.values());
  if (agentIds.length < 2) {
    console.log('  [SKIP] Need at least 2 agents for actions');
    return;
  }

  // Basic action types to create sessions
  const basicActions = [
    { type: 'communicate', cost: 2 },
    { type: 'create', cost: 3 },
    { type: 'associate', cost: 1 },
    { type: 'exchange', cost: 2 },
  ];

  // Generate actions for each agent
  for (let i = 0; i < agentIds.length; i++) {
    const agentId = agentIds[i];

    // 3-5 basic actions per agent
    for (let j = 0; j < 3 + (i % 3); j++) {
      const action = basicActions[j % basicActions.length];
      const idempotencyKey = deterministicId(`action:${agentId}:basic:${j}`);

      const { res, json } = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
        body: {
          action_type: action.type,
          requested_cost: action.cost,
          idempotency_key: idempotencyKey,
          payload: { seed: true, iteration: j },
        },
      });

      result.actions.total++;
      const data = json as { accepted?: boolean };
      if (res.ok && data?.accepted) {
        result.actions.accepted++;
      } else {
        result.actions.rejected++;
      }
    }

    console.log(`  [OK] Basic actions for agent ${i + 1}/${agentIds.length}`);
  }
}

async function seedPerceptionArtifacts(handleToId: Map<string, string>) {
  console.log('\n--- Seeding Perception Artifacts ---');

  const agentIds = Array.from(handleToId.values());
  if (agentIds.length < 2) {
    console.log('  [SKIP] Need at least 2 agents for perception artifacts');
    return;
  }

  const perceptionTypes = ['critique', 'counter_model', 'refusal', 'rederivation'] as const;

  // Create perception artifacts between agents
  for (let i = 0; i < agentIds.length; i++) {
    const issuingAgentId = agentIds[i];
    const subjectAgentId = agentIds[(i + 1) % agentIds.length]; // Next agent in rotation

    // Each agent creates 1-2 perception artifacts about another
    const numPerceptions = 1 + (i % 2);

    for (let j = 0; j < numPerceptions; j++) {
      const perceptionType = perceptionTypes[(i + j) % perceptionTypes.length];
      const idempotencyKey = deterministicId(`perception:${issuingAgentId}:${subjectAgentId}:${j}`);

      const { res, json } = await request(`${AGENTS_URL}/agents/${issuingAgentId}/attempt`, {
        body: {
          action_type: perceptionType,
          requested_cost: 5,
          idempotency_key: idempotencyKey,
          subject_agent_id: subjectAgentId,
          payload: {
            seed: true,
            summary: `Seeded ${perceptionType} artifact from agent ${i} about agent ${(i + 1) % agentIds.length}`,
          },
        },
      });

      result.actions.total++;
      const data = json as { accepted?: boolean };
      if (res.ok && data?.accepted) {
        result.actions.accepted++;
        result.perception_artifacts++;
      } else {
        result.actions.rejected++;
      }
    }

    console.log(`  [OK] Perception artifacts from agent ${i + 1}/${agentIds.length}`);
  }
}

async function seedEnvironmentConstraints() {
  console.log('\n--- Seeding Environment Constraints ---');

  // Set constraints on ox-sandbox to trigger some rejections
  const { res, json } = await request(`${AGENTS_URL}/admin/environment/ox-sandbox`, {
    method: 'PUT',
    body: {
      deployment_target: 'ox-sandbox',
      cognition_availability: 'degraded',
      max_throughput_per_minute: 100,
      throttle_factor: 1.5,
      reason: 'Seeded environment constraint for testing',
    },
    headers: {
      'x-ops-role': 'seed',
    },
  });

  if (res.ok) {
    result.environment_constraints_set.push('ox-sandbox');
    console.log('  [OK] Environment constraints set for ox-sandbox');
  } else {
    const err = `Environment ox-sandbox: ${res.status} ${JSON.stringify(json)}`;
    result.errors.push(err);
    console.log(`  [WARN] ${err}`);
  }

  // Set mild constraints on ox-lab
  const { res: res2, json: json2 } = await request(`${AGENTS_URL}/admin/environment/ox-lab`, {
    method: 'PUT',
    body: {
      deployment_target: 'ox-lab',
      cognition_availability: 'full',
      max_throughput_per_minute: 200,
      throttle_factor: 1.0,
      reason: 'Seeded environment constraint for testing (normal)',
    },
    headers: {
      'x-ops-role': 'seed',
    },
  });

  if (res2.ok) {
    result.environment_constraints_set.push('ox-lab');
    console.log('  [OK] Environment constraints set for ox-lab');
  } else {
    const err = `Environment ox-lab: ${res2.status} ${JSON.stringify(json2)}`;
    result.errors.push(err);
    console.log(`  [WARN] ${err}`);
  }
}

async function seedDriftConditions(handleToId: Map<string, string>) {
  console.log('\n--- Seeding Drift Conditions ---');

  // Find agents that exist in both deployments (we'll create cross-deployment patterns)
  // For drift, we need the same agent to act in multiple deployments
  // Since our agents are pre-assigned to deployments, we'll just ensure
  // there's activity variance between deployment targets

  const sandboxAgents = AGENTS.filter(a => a.deployment === 'ox-sandbox').map(a => handleToId.get(a.handle)).filter(Boolean) as string[];
  const labAgents = AGENTS.filter(a => a.deployment === 'ox-lab').map(a => handleToId.get(a.handle)).filter(Boolean) as string[];

  // Generate additional activity to create observable patterns
  const actionTypes = ['communicate', 'create', 'associate', 'exchange'];

  // More activity in sandbox
  for (const agentId of sandboxAgents) {
    for (let i = 0; i < 5; i++) {
      const actionType = actionTypes[i % actionTypes.length];
      const idempotencyKey = deterministicId(`drift:sandbox:${agentId}:${i}`);

      const { res, json } = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
        body: {
          action_type: actionType,
          requested_cost: 1,
          idempotency_key: idempotencyKey,
          payload: { drift_seed: true, deployment: 'ox-sandbox' },
        },
      });

      result.actions.total++;
      const data = json as { accepted?: boolean };
      if (res.ok && data?.accepted) {
        result.actions.accepted++;
      } else {
        result.actions.rejected++;
      }
    }
  }
  console.log(`  [OK] Extra activity for sandbox agents`);

  // Less activity in lab (creates drift observation)
  for (const agentId of labAgents) {
    for (let i = 0; i < 2; i++) {
      const actionType = actionTypes[i % actionTypes.length];
      const idempotencyKey = deterministicId(`drift:lab:${agentId}:${i}`);

      const { res, json } = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
        body: {
          action_type: actionType,
          requested_cost: 1,
          idempotency_key: idempotencyKey,
          payload: { drift_seed: true, deployment: 'ox-lab' },
        },
      });

      result.actions.total++;
      const data = json as { accepted?: boolean };
      if (res.ok && data?.accepted) {
        result.actions.accepted++;
      } else {
        result.actions.rejected++;
      }
    }
  }
  console.log(`  [OK] Activity for lab agents`);
}

async function waitForProjections() {
  console.log('\n--- Waiting for projections to materialize ---');

  // Give the event consumer time to process
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Check projection health
  const { res, json } = await request(`${OX_READ_URL}/ox/system/projection-health`, {
    headers: {
      'x-observer-id': 'obs_auditor',
      'x-observer-role': 'auditor',
    },
  });

  if (res.ok) {
    console.log('  [OK] Projection health check passed');
    console.log(`  Projections: ${JSON.stringify((json as any)?.projections)}`);
  } else {
    console.log(`  [WARN] Projection health check: ${res.status}`);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('OX Scenario Seeder');
  console.log('='.repeat(60));

  try {
    await ensureServicesHealthy();
    await seedObservers();
    const handleToId = await seedAgents();
    await seedEnvironmentConstraints();
    await seedActions(handleToId);
    await seedPerceptionArtifacts(handleToId);
    await seedDriftConditions(handleToId);
    await waitForProjections();

    console.log('\n' + '='.repeat(60));
    console.log('SEED COMPLETE');
    console.log('='.repeat(60));
    console.log('\nSummary:');
    console.log(JSON.stringify(result, null, 2));

    // Write result to stdout as JSON for automation
    if (process.env.OX_SEED_JSON_OUTPUT) {
      console.log('\n--- JSON Output ---');
      console.log(JSON.stringify(result));
    }

  } catch (err) {
    console.error('\nSEED FAILED:', err);
    process.exit(1);
  }
}

main();
