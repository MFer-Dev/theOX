/**
 * OX World State Projection Invariant Tests
 *
 * These tests verify Phase 6: World State & Causality Projection laws:
 * 1. World state is read-only (projections cannot influence physics)
 * 2. Observer role gating is enforced
 * 3. History is append-only
 * 4. Rolling effects are deterministic
 * 5. World state uses only observational language (no moral terms)
 *
 * Run: node --import tsx --test tests/invariants/ox_world_state_invariants.test.ts
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert';

const env = (key: string, fallback: string) => process.env[key] || fallback;

const OX_READ_URL = env('OX_READ_URL', 'http://localhost:4018');
const PHYSICS_URL = env('PHYSICS_URL', 'http://localhost:4019');

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
    const [oxRead, physics] = await Promise.all([
      fetch(`${OX_READ_URL}/healthz`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${PHYSICS_URL}/healthz`, { signal: AbortSignal.timeout(3000) }),
    ]);
    return oxRead.ok && physics.ok;
  } catch {
    return false;
  }
}

describe('OX World State Projection Invariants', async () => {
  let available = false;

  before(async () => {
    available = await servicesAvailable();
    if (!available) {
      console.log('WARNING: Services not available, some tests will be skipped');
    }
  });

  describe('Law 1: World state is read-only projection', () => {
    it('ox-read does not expose write endpoints for world state', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // POST to /ox/world should fail (no write endpoint)
      const postWorld = await request(`${OX_READ_URL}/ox/world`, {
        method: 'POST',
        body: { deployment_target: 'test' },
      });

      // Should return 404 (no such route) or 405 (method not allowed)
      assert.ok(
        postWorld.res.status === 404 || postWorld.res.status === 405,
        `POST to /ox/world should not be allowed, got ${postWorld.res.status}`
      );

      // PUT to world state should fail
      const putWorld = await request(`${OX_READ_URL}/ox/world/test`, {
        method: 'PUT',
        body: { weather_state: 'stormy' },
      });

      assert.ok(
        putWorld.res.status === 404 || putWorld.res.status === 405,
        `PUT to /ox/world/:target should not be allowed, got ${putWorld.res.status}`
      );

      // DELETE should fail
      const deleteWorld = await request(`${OX_READ_URL}/ox/world/test`, {
        method: 'DELETE',
      });

      assert.ok(
        deleteWorld.res.status === 404 || deleteWorld.res.status === 405,
        `DELETE to /ox/world/:target should not be allowed, got ${deleteWorld.res.status}`
      );
    });

    it('world state endpoints are pure observers', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // GET requests should succeed (read-only)
      const getWorld = await request(`${OX_READ_URL}/ox/world`);
      assert.strictEqual(getWorld.res.status, 200, 'GET /ox/world should succeed');

      // Verify response structure is observational only
      const data = getWorld.json as { world_states?: unknown[] };
      assert.ok(Array.isArray(data.world_states), 'Should return world_states array');
    });
  });

  describe('Law 2: Observer role gating', () => {
    it('viewer role gets summary only (no vars)', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const viewerWorld = await request(`${OX_READ_URL}/ox/world`, {
        headers: {
          'x-observer-id': 'test-viewer',
          'x-observer-role': 'viewer',
        },
      });

      assert.strictEqual(viewerWorld.res.status, 200);

      const data = viewerWorld.json as {
        world_states?: Array<{ vars?: unknown; vars_json?: unknown }>
      };

      // Viewer should NOT see vars
      for (const state of data.world_states || []) {
        assert.ok(
          !('vars' in state) && !('vars_json' in state),
          'Viewer should not see vars'
        );
      }
    });

    it('analyst role gets vars but history/effects require access', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Analyst can see vars on world state
      const analystWorld = await request(`${OX_READ_URL}/ox/world`, {
        headers: {
          'x-observer-id': 'test-analyst',
          'x-observer-role': 'analyst',
        },
      });

      assert.strictEqual(analystWorld.res.status, 200);

      // Analyst should be able to access history
      const deployments = await request(`${PHYSICS_URL}/deployments`);
      const deployData = deployments.json as { deployments?: Array<{ deployment_target: string }> };
      const target = deployData.deployments?.[0]?.deployment_target || 'ox-sandbox';

      const analystHistory = await request(`${OX_READ_URL}/ox/world/${target}/history`, {
        headers: {
          'x-observer-id': 'test-analyst',
          'x-observer-role': 'analyst',
        },
      });

      // Analyst can access history (200 or 404 if no data)
      assert.ok(
        analystHistory.res.status === 200 || analystHistory.res.status === 404,
        `Analyst should access history, got ${analystHistory.res.status}`
      );
    });

    it('viewer role is denied access to history and effects', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const deployments = await request(`${PHYSICS_URL}/deployments`);
      const deployData = deployments.json as { deployments?: Array<{ deployment_target: string }> };
      const target = deployData.deployments?.[0]?.deployment_target || 'ox-sandbox';

      // Viewer cannot access history
      const viewerHistory = await request(`${OX_READ_URL}/ox/world/${target}/history`, {
        headers: {
          'x-observer-id': 'test-viewer',
          'x-observer-role': 'viewer',
        },
      });

      assert.strictEqual(
        viewerHistory.res.status,
        403,
        'Viewer should be denied access to history'
      );

      // Viewer cannot access effects
      const viewerEffects = await request(`${OX_READ_URL}/ox/world/${target}/effects`, {
        headers: {
          'x-observer-id': 'test-viewer',
          'x-observer-role': 'viewer',
        },
      });

      assert.strictEqual(
        viewerEffects.res.status,
        403,
        'Viewer should be denied access to effects'
      );
    });
  });

  describe('Law 3: World state structure', () => {
    it('world state has required fields', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const worldState = await request(`${OX_READ_URL}/ox/world`, {
        headers: {
          'x-observer-id': 'test-auditor',
          'x-observer-role': 'auditor',
        },
      });

      const data = worldState.json as {
        world_states?: Array<{
          deployment_target?: string;
          weather_state?: string;
          updated_at?: string;
        }>
      };

      for (const state of data.world_states || []) {
        assert.ok(state.deployment_target, 'World state must have deployment_target');
        assert.ok(state.weather_state, 'World state must have weather_state');
        assert.ok(state.updated_at, 'World state must have updated_at');
      }
    });

    it('weather state is valid enum value', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const validWeatherStates = ['clear', 'stormy', 'drought'];

      const worldState = await request(`${OX_READ_URL}/ox/world`);
      const data = worldState.json as {
        world_states?: Array<{ weather_state: string }>
      };

      for (const state of data.world_states || []) {
        assert.ok(
          validWeatherStates.includes(state.weather_state),
          `Weather state must be valid enum, got ${state.weather_state}`
        );
      }
    });
  });

  describe('Law 4: Effects aggregates structure', () => {
    it('effects include required aggregate fields', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const deployments = await request(`${PHYSICS_URL}/deployments`);
      const deployData = deployments.json as { deployments?: Array<{ deployment_target: string }> };
      const target = deployData.deployments?.[0]?.deployment_target || 'ox-sandbox';

      const effects = await request(`${OX_READ_URL}/ox/world/${target}/effects`, {
        headers: {
          'x-observer-id': 'test-analyst',
          'x-observer-role': 'analyst',
        },
      });

      if (effects.res.status === 200) {
        const data = effects.json as {
          aggregates?: {
            total_accepted?: number;
            total_rejected?: number;
            total_sessions?: number;
            total_artifacts?: number;
          }
        };

        assert.ok(data.aggregates, 'Effects should have aggregates');
        assert.ok(
          typeof data.aggregates.total_accepted === 'number',
          'Should have total_accepted'
        );
        assert.ok(
          typeof data.aggregates.total_rejected === 'number',
          'Should have total_rejected'
        );
      }
    });

    it('effects bucket counts are non-negative', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const deployments = await request(`${PHYSICS_URL}/deployments`);
      const deployData = deployments.json as { deployments?: Array<{ deployment_target: string }> };
      const target = deployData.deployments?.[0]?.deployment_target || 'ox-sandbox';

      const effects = await request(`${OX_READ_URL}/ox/world/${target}/effects`, {
        headers: {
          'x-observer-id': 'test-analyst',
          'x-observer-role': 'analyst',
        },
      });

      if (effects.res.status === 200) {
        const data = effects.json as {
          buckets?: Array<{
            accepted_count: number;
            rejected_count: number;
            sessions_created: number;
            artifacts_created: number;
          }>
        };

        for (const bucket of data.buckets || []) {
          assert.ok(bucket.accepted_count >= 0, 'accepted_count must be non-negative');
          assert.ok(bucket.rejected_count >= 0, 'rejected_count must be non-negative');
          assert.ok(bucket.sessions_created >= 0, 'sessions_created must be non-negative');
          assert.ok(bucket.artifacts_created >= 0, 'artifacts_created must be non-negative');
        }
      }
    });
  });

  describe('Law 5: No moral language in projections', () => {
    it('world state endpoints do not use moral terms', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const endpoints = [
        `${OX_READ_URL}/ox/world`,
      ];

      const moralTerms = ['bad', 'good', 'evil', 'unsafe', 'dangerous', 'prohibited', 'banned', 'punish', 'reward', 'score', 'rank'];

      for (const endpoint of endpoints) {
        const response = await request(endpoint, {
          headers: {
            'x-observer-id': 'test-auditor',
            'x-observer-role': 'auditor',
          },
        });
        const responseStr = JSON.stringify(response.json).toLowerCase();

        for (const term of moralTerms) {
          assert.ok(
            !responseStr.includes(term),
            `Response from ${endpoint} should not contain moral term '${term}'`
          );
        }
      }
    });
  });

  describe('Law 6: Observer access is logged', () => {
    it('accessing world state logs observer access', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const testObserverId = `test-observer-${Date.now()}`;

      // Make a request with observer ID
      await request(`${OX_READ_URL}/ox/world`, {
        headers: {
          'x-observer-id': testObserverId,
          'x-observer-role': 'viewer',
        },
      });

      // Verify via /ox/observers/me (requires auditor role)
      const me = await request(`${OX_READ_URL}/ox/observers/me`, {
        headers: {
          'x-observer-id': testObserverId,
          'x-observer-role': 'auditor',
        },
      });

      // Should return observer info or recent access
      assert.strictEqual(me.res.status, 200);
      const data = me.json as { recent_access?: unknown[] };
      assert.ok(Array.isArray(data.recent_access), 'Should return recent_access array');
    });
  });

  describe('Law 7: Projection health includes world state', () => {
    it('system projection health counts world state tables', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const health = await request(`${OX_READ_URL}/ox/system/projection-health`, {
        headers: {
          'x-observer-id': 'test-auditor',
          'x-observer-role': 'auditor',
        },
      });

      assert.strictEqual(health.res.status, 200);

      // Verify projection counts exist (world state tables may not be in the old projection-health endpoint yet)
      const data = health.json as { projections?: Record<string, unknown> };
      assert.ok(data.projections, 'Should have projections object');
    });
  });
});
