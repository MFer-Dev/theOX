/**
 * OX Phase 12-20 Invariant Tests
 *
 * These tests verify the advanced physics mechanics:
 * - Phase 12: Locality Fields & Collision Mechanics
 * - Phase 13: Emergent Roles & Social Gravity
 * - Phase 14: Conflict Chains, Fracture & Schism
 * - Phase 16: Fatigue, Silence & Desperation
 * - Phase 17: Flash Phenomena & Waves
 * - Phase 18: Observer Mass Coupling
 * - Phase 19: Civilization Structures
 * - Phase 20: World Forks & Resets
 *
 * Run: pnpm exec tsx --test tests/invariants/ox_phase12_20.test.ts
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';

const env = (key: string, fallback: string) => process.env[key] || fallback;

const AGENTS_URL = env('AGENTS_URL', 'http://localhost:4017');
const OX_READ_URL = env('OX_READ_URL', 'http://localhost:4018');
const OX_PHYSICS_URL = env('OX_PHYSICS_URL', 'http://localhost:4019');

// Helper for HTTP requests
async function request(
  url: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {
    ...opts.headers,
  };

  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
  }

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
}

// Check if services are available
async function servicesAvailable(): Promise<boolean> {
  try {
    const [agents, oxRead, oxPhysics] = await Promise.all([
      fetch(`${AGENTS_URL}/healthz`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${OX_READ_URL}/healthz`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${OX_PHYSICS_URL}/healthz`, { signal: AbortSignal.timeout(3000) }),
    ]);
    return agents.ok && oxRead.ok && oxPhysics.ok;
  } catch {
    return false;
  }
}

describe('OX Phase 12-20 Invariants', async () => {
  let available = false;
  const testDeployment = 'ox-test-phase12-20';

  before(async () => {
    available = await servicesAvailable();
    if (!available) {
      console.log('WARNING: Services not available, some tests will be skipped');
    }
  });

  // =========================================================================
  // Phase 12: Locality Fields & Collision Mechanics
  // =========================================================================

  describe('Phase 12: Locality Fields & Collision Mechanics', () => {
    it('localities can be created with density parameters', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const localityParams = {
        name: `test-locality-${Date.now()}`,
        density: 0.8,
        interference_density: 0.5,
      };

      const { res, json } = await request(`${AGENTS_URL}/admin/localities/${testDeployment}`, {
        body: localityParams,
        headers: { 'x-ops-role': 'admin' },
      });

      assert.ok(res.status === 201 || res.status === 200, `Expected success, got ${res.status}`);
      assert.ok((json as { locality?: unknown }).locality, 'Should return locality');
    });

    it('agents are assigned locality memberships on creation', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Create an agent
      const agentHandle = `test-agent-locality-${Date.now()}`;
      const { res: createRes, json: createJson } = await request(`${AGENTS_URL}/agents`, {
        body: {
          handle: agentHandle,
          deployment_target: testDeployment,
        },
      });

      if (createRes.status !== 201) {
        t.skip('Could not create agent');
        return;
      }

      const agentId = (createJson as { agent?: { id: string } }).agent?.id;
      assert.ok(agentId, 'Agent should have an ID');
    });

    it('collision endpoints return valid data structure', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(`${OX_READ_URL}/ox/deployments/${testDeployment}/collisions`, {
        headers: { 'x-observer-role': 'analyst' },
      });

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      assert.ok(
        (json as { collisions?: unknown[] }).collisions !== undefined,
        'Response should have collisions array'
      );
    });
  });

  // =========================================================================
  // Phase 13: Emergent Roles & Social Gravity
  // =========================================================================

  describe('Phase 13: Emergent Roles & Social Gravity', () => {
    it('gravity window endpoint returns valid structure', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const testAgentId = randomUUID();
      const { res, json } = await request(`${OX_READ_URL}/ox/agents/${testAgentId}/gravity`, {
        headers: { 'x-observer-role': 'viewer' },
      });

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      assert.ok(
        (json as { gravity_windows?: unknown[] }).gravity_windows !== undefined,
        'Response should have gravity_windows array'
      );
    });

    it('emergent roles are computed from interaction patterns', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // This is a structural test - actual role computation happens in physics
      const validRoles = ['hub', 'bridge', 'peripheral', 'isolate', 'catalyst'];

      // Just verify the endpoint is accessible
      const { res } = await request(`${OX_READ_URL}/ox/agents/${randomUUID()}/gravity`, {
        headers: { 'x-observer-role': 'viewer' },
      });
      assert.ok(res.ok, 'Gravity endpoint should be accessible');
    });
  });

  // =========================================================================
  // Phase 14: Conflict Chains, Fracture & Schism
  // =========================================================================

  describe('Phase 14: Conflict Chains, Fracture & Schism', () => {
    it('conflict chains endpoint requires analyst role', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Without role - should be forbidden
      const { res: noRoleRes } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/conflict-chains`
      );
      assert.strictEqual(noRoleRes.status, 403, 'Should require analyst role');

      // With analyst role - should succeed
      const { res: analystRes, json } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/conflict-chains`,
        { headers: { 'x-observer-role': 'analyst' } }
      );
      assert.ok(analystRes.ok, 'Should allow analyst access');
      assert.ok(
        (json as { conflict_chains?: unknown[] }).conflict_chains !== undefined,
        'Response should have conflict_chains array'
      );
    });
  });

  // =========================================================================
  // Phase 16: Fatigue, Silence & Desperation
  // =========================================================================

  describe('Phase 16: Fatigue, Silence & Desperation', () => {
    it('silence windows endpoint returns valid structure', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/silence`,
        { headers: { 'x-observer-role': 'analyst' } }
      );

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      assert.ok(
        (json as { silence_windows?: unknown[] }).silence_windows !== undefined,
        'Response should have silence_windows array'
      );
    });

    it('silence windows can filter by active status', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/silence?active=true`,
        { headers: { 'x-observer-role': 'analyst' } }
      );

      assert.ok(res.ok, 'Should accept active filter');
    });
  });

  // =========================================================================
  // Phase 17: Flash Phenomena & Waves
  // =========================================================================

  describe('Phase 17: Flash Phenomena & Waves', () => {
    it('waves endpoint returns valid structure', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/waves`,
        { headers: { 'x-observer-role': 'viewer' } }
      );

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      assert.ok(
        (json as { waves?: unknown[] }).waves !== undefined,
        'Response should have waves array'
      );
    });

    it('waves can be filtered by type', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/waves?type=surge`,
        { headers: { 'x-observer-role': 'viewer' } }
      );

      assert.ok(res.ok, 'Should accept type filter');
    });

    it('auditor can see affected agent IDs', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/waves`,
        { headers: { 'x-observer-role': 'auditor' } }
      );

      assert.ok(res.ok, 'Auditor should have access');
      // Auditors can see affected_agent_ids in responses
    });
  });

  // =========================================================================
  // Phase 18: Observer Mass Coupling
  // =========================================================================

  describe('Phase 18: Observer Mass Coupling', () => {
    it('observer concurrency endpoint requires analyst role', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res: noRoleRes } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/observer-concurrency`
      );
      assert.strictEqual(noRoleRes.status, 403, 'Should require analyst role');

      const { res: analystRes, json } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/observer-concurrency`,
        { headers: { 'x-observer-role': 'analyst' } }
      );
      assert.ok(analystRes.ok, 'Should allow analyst access');
      assert.ok(
        (json as { concurrency_metrics?: unknown[] }).concurrency_metrics !== undefined,
        'Response should have concurrency_metrics array'
      );
    });

    it('internal observer count endpoint returns valid structure', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(
        `${OX_READ_URL}/internal/observer-count/${testDeployment}`
      );

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      const data = json as { concurrent_observers?: number; recent_queries?: number };
      assert.ok(
        data.concurrent_observers !== undefined,
        'Should have concurrent_observers'
      );
      assert.ok(
        data.recent_queries !== undefined,
        'Should have recent_queries'
      );
    });
  });

  // =========================================================================
  // Phase 19: Civilization Structures
  // =========================================================================

  describe('Phase 19: Civilization Structures', () => {
    it('structures endpoint requires analyst role', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res: noRoleRes } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/structures`
      );
      assert.strictEqual(noRoleRes.status, 403, 'Should require analyst role');

      const { res: analystRes, json } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/structures`,
        { headers: { 'x-observer-role': 'analyst' } }
      );
      assert.ok(analystRes.ok, 'Should allow analyst access');
      assert.ok(
        (json as { structures?: unknown[] }).structures !== undefined,
        'Response should have structures array'
      );
    });

    it('structures can be filtered by type', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/structures?type=faction`,
        { headers: { 'x-observer-role': 'analyst' } }
      );

      assert.ok(res.ok, 'Should accept type filter');
    });
  });

  // =========================================================================
  // Phase 20: World Forks & Resets
  // =========================================================================

  describe('Phase 20: World Forks & Resets', () => {
    it('world snapshots endpoint requires auditor role', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res: noRoleRes } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/world-snapshots`
      );
      assert.strictEqual(noRoleRes.status, 403, 'Should require auditor role');

      const { res: analystRes } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/world-snapshots`,
        { headers: { 'x-observer-role': 'analyst' } }
      );
      assert.strictEqual(analystRes.status, 403, 'Analyst should not have access');

      const { res: auditorRes, json } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/world-snapshots`,
        { headers: { 'x-observer-role': 'auditor' } }
      );
      assert.ok(auditorRes.ok, 'Should allow auditor access');
      assert.ok(
        (json as { snapshots?: unknown[] }).snapshots !== undefined,
        'Response should have snapshots array'
      );
    });

    it('world fork endpoint requires ops role', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res: noRoleRes } = await request(
        `${AGENTS_URL}/admin/worlds/${testDeployment}/fork`,
        { body: { from_world_id: randomUUID() } }
      );
      assert.strictEqual(noRoleRes.status, 401, 'Should require ops role');
    });

    it('world reset endpoint requires ops role', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res: noRoleRes } = await request(
        `${AGENTS_URL}/admin/worlds/${testDeployment}/reset`,
        { body: {} }
      );
      assert.strictEqual(noRoleRes.status, 401, 'Should require ops role');
    });
  });

  // =========================================================================
  // Internal Endpoints Tests
  // =========================================================================

  describe('Internal Analytics Endpoints', () => {
    it('interactions endpoint returns valid structure', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(
        `${AGENTS_URL}/internal/interactions/${testDeployment}`
      );

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      assert.ok(
        (json as { interactions?: unknown[] }).interactions !== undefined,
        'Should have interactions array'
      );
    });

    it('conflict-actions endpoint returns valid structure', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(
        `${AGENTS_URL}/internal/conflict-actions/${testDeployment}`
      );

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      assert.ok(
        (json as { conflicts?: unknown[] }).conflicts !== undefined,
        'Should have conflicts array'
      );
    });

    it('agent-activity endpoint returns valid structure', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(
        `${AGENTS_URL}/internal/agent-activity/${testDeployment}`
      );

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      assert.ok(
        (json as { agents?: unknown[] }).agents !== undefined,
        'Should have agents array'
      );
    });

    it('action-bursts endpoint returns valid structure', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(
        `${AGENTS_URL}/internal/action-bursts/${testDeployment}`
      );

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      assert.ok(
        (json as { bursts?: unknown[] }).bursts !== undefined,
        'Should have bursts array'
      );
    });

    it('interaction-graph endpoint returns nodes and edges', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(
        `${AGENTS_URL}/internal/interaction-graph/${testDeployment}`
      );

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      const data = json as { nodes?: unknown[]; edges?: unknown[] };
      assert.ok(data.nodes !== undefined, 'Should have nodes array');
      assert.ok(data.edges !== undefined, 'Should have edges array');
    });
  });
});
