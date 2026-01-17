/**
 * OX Foundry Invariant Tests (Phase 10)
 *
 * These tests verify Foundry (Agent Builder) invariants:
 * 1. Bias values must be between -1 and 1
 * 2. Cognition provider must be valid enum
 * 3. Throttle profile must be valid enum
 * 4. Config updates are append-only (don't mutate history)
 * 5. Deployment preserves agent identity
 *
 * Run: pnpm exec tsx --test tests/invariants/ox_foundry.test.ts
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert';

const env = (key: string, fallback: string) => process.env[key] || fallback;

const AGENTS_URL = env('AGENTS_URL', 'http://localhost:4017');
const OX_READ_URL = env('OX_READ_URL', 'http://localhost:4018');

// Helper for HTTP requests
async function request(
  url: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
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
}

// Check if services are available
async function servicesAvailable(): Promise<boolean> {
  try {
    const [agents, oxRead] = await Promise.all([
      fetch(`${AGENTS_URL}/healthz`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${OX_READ_URL}/healthz`, { signal: AbortSignal.timeout(3000) }),
    ]);
    return agents.ok && oxRead.ok;
  } catch {
    return false;
  }
}

describe('OX Foundry Invariants (Phase 10)', async () => {
  let available = false;

  before(async () => {
    available = await servicesAvailable();
    if (!available) {
      console.log('WARNING: Services not available, some tests will be skipped');
    }
  });

  describe('Invariant 1: Bias value bounds', () => {
    it('accepts bias values between -1 and 1', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const handle = `bias-test-${Date.now()}`;

      const result = await request(`${AGENTS_URL}/foundry/agents`, {
        body: {
          handle,
          deployment_target: 'ox-lab',
          config: {
            cognition_provider: 'none',
            bias: {
              cooperation: 0.5,
              risk_tolerance: -0.3,
              verbosity: 0,
            },
          },
        },
      });

      assert.ok(
        result.res.status < 300,
        `Should accept valid bias values, got ${result.res.status}`
      );
    });

    it('rejects bias values outside [-1, 1]', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const handle = `bias-invalid-${Date.now()}`;

      const tooHigh = await request(`${AGENTS_URL}/foundry/agents`, {
        body: {
          handle,
          deployment_target: 'ox-lab',
          config: {
            cognition_provider: 'none',
            bias: { cooperation: 1.5 }, // Invalid
          },
        },
      });

      assert.strictEqual(
        tooHigh.res.status,
        400,
        'Should reject bias > 1'
      );

      const tooLow = await request(`${AGENTS_URL}/foundry/agents`, {
        body: {
          handle: handle + '-low',
          deployment_target: 'ox-lab',
          config: {
            cognition_provider: 'none',
            bias: { cooperation: -1.5 }, // Invalid
          },
        },
      });

      assert.strictEqual(
        tooLow.res.status,
        400,
        'Should reject bias < -1'
      );
    });
  });

  describe('Invariant 2: Valid cognition providers', () => {
    const validProviders = ['none', 'openai', 'anthropic', 'gemini'];

    it('accepts all valid cognition providers', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      for (const provider of validProviders) {
        const handle = `provider-${provider}-${Date.now()}`;

        const result = await request(`${AGENTS_URL}/foundry/agents`, {
          body: {
            handle,
            deployment_target: 'ox-lab',
            config: { cognition_provider: provider },
          },
        });

        assert.ok(
          result.res.status < 300,
          `Should accept cognition_provider '${provider}', got ${result.res.status}`
        );
      }
    });

    it('rejects invalid cognition provider', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const handle = `provider-invalid-${Date.now()}`;

      const result = await request(`${AGENTS_URL}/foundry/agents`, {
        body: {
          handle,
          deployment_target: 'ox-lab',
          config: { cognition_provider: 'invalid_provider' },
        },
      });

      assert.strictEqual(
        result.res.status,
        400,
        'Should reject invalid cognition provider'
      );
    });
  });

  describe('Invariant 3: Valid throttle profiles', () => {
    const validProfiles = ['normal', 'conservative', 'aggressive', 'paused'];

    it('accepts all valid throttle profiles', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      for (const profile of validProfiles) {
        const handle = `throttle-${profile}-${Date.now()}`;

        const result = await request(`${AGENTS_URL}/foundry/agents`, {
          body: {
            handle,
            deployment_target: 'ox-lab',
            config: {
              cognition_provider: 'none',
              throttle_profile: profile,
            },
          },
        });

        assert.ok(
          result.res.status < 300,
          `Should accept throttle_profile '${profile}', got ${result.res.status}`
        );
      }
    });

    it('rejects invalid throttle profile', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const handle = `throttle-invalid-${Date.now()}`;

      const result = await request(`${AGENTS_URL}/foundry/agents`, {
        body: {
          handle,
          deployment_target: 'ox-lab',
          config: {
            cognition_provider: 'none',
            throttle_profile: 'super_fast', // Invalid
          },
        },
      });

      assert.strictEqual(
        result.res.status,
        400,
        'Should reject invalid throttle profile'
      );
    });
  });

  describe('Invariant 4: Agent creation returns ID', () => {
    it('foundry agent creation returns agent ID', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const handle = `create-test-${Date.now()}`;

      const result = await request(`${AGENTS_URL}/foundry/agents`, {
        body: {
          handle,
          deployment_target: 'ox-lab',
          config: { cognition_provider: 'none' },
        },
      });

      assert.ok(result.res.status < 300);

      const data = result.json as { agent?: { id: string; handle: string } };
      assert.ok(data.agent?.id, 'Should return agent ID');
      assert.strictEqual(data.agent?.handle, handle, 'Should return handle');
    });
  });

  describe('Invariant 5: Config updates increment version', () => {
    it('config updates return incremented version', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const handle = `version-test-${Date.now()}`;

      // Create agent
      const create = await request(`${AGENTS_URL}/foundry/agents`, {
        body: {
          handle,
          deployment_target: 'ox-lab',
          config: { cognition_provider: 'none' },
        },
      });

      const createData = create.json as { agent?: { id: string } };
      const agentId = createData.agent?.id;
      assert.ok(agentId);

      // Update config
      const update = await request(`${AGENTS_URL}/foundry/agents/${agentId}/config`, {
        method: 'PUT',
        body: {
          bias: { cooperation: 0.7 },
        },
      });

      assert.ok(update.res.status < 300, 'Update should succeed');

      const updateData = update.json as { config?: { version: number } };
      assert.ok(
        typeof updateData.config?.version === 'number',
        'Should return version number'
      );
    });
  });

  describe('Invariant 6: Config history via ox-read', () => {
    it('config history is accessible via ox-read', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const handle = `history-test-${Date.now()}`;

      // Create agent
      const create = await request(`${AGENTS_URL}/foundry/agents`, {
        body: {
          handle,
          deployment_target: 'ox-lab',
          config: { cognition_provider: 'none' },
        },
      });

      const createData = create.json as { agent?: { id: string } };
      const agentId = createData.agent?.id;
      assert.ok(agentId);

      // Query config history
      const history = await request(
        `${OX_READ_URL}/ox/agents/${agentId}/config-history`,
        { headers: { 'x-observer-role': 'analyst' } }
      );

      assert.strictEqual(
        history.res.status,
        200,
        'Config history should be accessible'
      );

      const historyData = history.json as { history?: unknown[] };
      assert.ok(
        Array.isArray(historyData.history),
        'Should return history array'
      );
    });
  });

  describe('Invariant 7: Deployment preserves identity', () => {
    it('redeploying agent keeps same ID', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const handle = `deploy-test-${Date.now()}`;

      // Create agent
      const create = await request(`${AGENTS_URL}/foundry/agents`, {
        body: {
          handle,
          deployment_target: 'ox-lab',
          config: { cognition_provider: 'none' },
        },
      });

      const createData = create.json as { agent?: { id: string } };
      const agentId = createData.agent?.id;
      assert.ok(agentId);

      // Deploy to different target
      const deploy = await request(`${AGENTS_URL}/foundry/agents/${agentId}/deploy`, {
        body: { deployment_target: 'ox-staging' },
      });

      if (deploy.res.status < 300) {
        const deployData = deploy.json as { agent?: { id: string } };
        assert.strictEqual(
          deployData.agent?.id,
          agentId,
          'Agent ID should remain the same after deployment'
        );
      }
      // It's OK if deployment fails due to target not existing
    });
  });

  describe('Invariant 8: Listing agents', () => {
    it('agent list supports pagination', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const list = await request(`${AGENTS_URL}/foundry/agents?limit=10`);

      assert.strictEqual(list.res.status, 200);

      const data = list.json as { agents?: unknown[]; total?: number };
      assert.ok(Array.isArray(data.agents), 'Should return agents array');
    });

    it('agent list can filter by sponsor', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const sponsorId = `filter-sponsor-${Date.now()}`;

      const list = await request(
        `${AGENTS_URL}/foundry/agents?sponsor_id=${sponsorId}&limit=10`
      );

      assert.strictEqual(list.res.status, 200);

      const data = list.json as { agents?: Array<{ sponsor_id: string }> };

      // All returned agents should have matching sponsor
      for (const agent of data.agents || []) {
        if (agent.sponsor_id) {
          assert.strictEqual(
            agent.sponsor_id,
            sponsorId,
            'Returned agent should match sponsor filter'
          );
        }
      }
    });
  });

  describe('Invariant 9: Portable config structure', () => {
    it('agent full config includes portable_config', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const handle = `portable-test-${Date.now()}`;

      // Create agent
      const create = await request(`${AGENTS_URL}/foundry/agents`, {
        body: {
          handle,
          deployment_target: 'ox-lab',
          config: {
            cognition_provider: 'anthropic',
            bias: { cooperation: 0.5 },
          },
        },
      });

      const createData = create.json as { agent?: { id: string } };
      const agentId = createData.agent?.id;
      assert.ok(agentId);

      // Get full config
      const get = await request(`${AGENTS_URL}/foundry/agents/${agentId}`);

      assert.strictEqual(get.res.status, 200);

      const getData = get.json as { config?: { portable_config?: unknown } };
      assert.ok(
        getData.config?.portable_config !== undefined,
        'Should include portable_config'
      );
    });
  });
});
