/**
 * OX Physics Engine Invariant Tests
 *
 * These tests verify the physics engine laws are enforced:
 * 1. Physics is reaction-blind (never reads ox-read or projections)
 * 2. Physics values stay within bounds
 * 3. RNG is deterministic given same seed
 * 4. Physics only calls agents admin endpoint (not other endpoints)
 *
 * Run: node --import tsx --test tests/invariants/ox_physics_invariants.test.ts
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert';

const env = (key: string, fallback: string) => process.env[key] || fallback;

const PHYSICS_URL = env('PHYSICS_URL', 'http://localhost:4019');
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
    const [physics, oxRead] = await Promise.all([
      fetch(`${PHYSICS_URL}/healthz`, { signal: AbortSignal.timeout(3000) }),
      fetch(`${OX_READ_URL}/healthz`, { signal: AbortSignal.timeout(3000) }),
    ]);
    return physics.ok && oxRead.ok;
  } catch {
    return false;
  }
}

describe('OX Physics Engine Invariants', async () => {
  let available = false;

  before(async () => {
    available = await servicesAvailable();
    if (!available) {
      console.log('WARNING: Services not available, some tests will be skipped');
    }
  });

  describe('Law 1: Physics is reaction-blind', () => {
    it('physics service does not expose ox-read dependencies', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Verify physics health check does NOT check ox-read
      const health = await request(`${PHYSICS_URL}/readyz`);
      assert.strictEqual(health.res.status, 200, 'Physics should be healthy');

      const data = health.json as { checks?: Record<string, boolean> };
      assert.ok(data.checks, 'Should have checks object');

      // Physics should check agents_service but NOT ox-read
      assert.ok(
        !('ox_read' in (data.checks || {})),
        'Physics should NOT have ox_read dependency'
      );
      assert.ok(
        !('projections' in (data.checks || {})),
        'Physics should NOT have projections dependency'
      );
    });

    it('physics endpoints do not return projection data', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Get deployment state
      const deployments = await request(`${PHYSICS_URL}/deployments`);
      assert.strictEqual(deployments.res.status, 200);

      const data = deployments.json as { deployments?: unknown[] };
      const deploymentsArray = data.deployments || [];

      // Verify no projection-related fields
      const projectionTerms = ['session', 'artifact', 'observer', 'live_event', 'drift'];

      for (const deployment of deploymentsArray) {
        const deploymentStr = JSON.stringify(deployment).toLowerCase();
        for (const term of projectionTerms) {
          assert.ok(
            !deploymentStr.includes(term),
            `Deployment state should not contain projection term '${term}'`
          );
        }
      }
    });
  });

  describe('Law 2: Physics values stay within bounds', () => {
    it('throughput cap is always positive', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const deployments = await request(`${PHYSICS_URL}/deployments`);
      const data = deployments.json as { deployments?: Array<{ current_throughput_cap: number }> };

      for (const d of data.deployments || []) {
        assert.ok(
          d.current_throughput_cap > 0,
          `Throughput cap must be positive, got ${d.current_throughput_cap}`
        );
        assert.ok(
          d.current_throughput_cap <= 10000,
          `Throughput cap must be <= 10000, got ${d.current_throughput_cap}`
        );
      }
    });

    it('throttle factor is within valid range', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const deployments = await request(`${PHYSICS_URL}/deployments`);
      const data = deployments.json as { deployments?: Array<{ current_throttle_factor: number }> };

      for (const d of data.deployments || []) {
        assert.ok(
          d.current_throttle_factor >= 0.1,
          `Throttle factor must be >= 0.1, got ${d.current_throttle_factor}`
        );
        assert.ok(
          d.current_throttle_factor <= 10,
          `Throttle factor must be <= 10, got ${d.current_throttle_factor}`
        );
      }
    });

    it('cognition availability is valid enum', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const validValues = ['full', 'degraded', 'unavailable'];

      const deployments = await request(`${PHYSICS_URL}/deployments`);
      const data = deployments.json as { deployments?: Array<{ current_cognition_availability: string }> };

      for (const d of data.deployments || []) {
        assert.ok(
          validValues.includes(d.current_cognition_availability),
          `Cognition availability must be valid enum, got ${d.current_cognition_availability}`
        );
      }
    });

    it('weather state is valid enum', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const validValues = ['clear', 'stormy', 'drought'];

      const deployments = await request(`${PHYSICS_URL}/deployments`);
      const data = deployments.json as { deployments?: Array<{ weather_state: string }> };

      for (const d of data.deployments || []) {
        assert.ok(
          validValues.includes(d.weather_state),
          `Weather state must be valid enum, got ${d.weather_state}`
        );
      }
    });
  });

  describe('Law 3: Regime probabilities are valid', () => {
    it('regime probabilities are between 0 and 1', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const regimes = await request(`${PHYSICS_URL}/regimes`);
      const data = regimes.json as {
        regimes?: Array<{ storm_probability: number; drought_probability: number }>
      };

      for (const r of data.regimes || []) {
        assert.ok(
          r.storm_probability >= 0 && r.storm_probability <= 1,
          `Storm probability must be in [0,1], got ${r.storm_probability}`
        );
        assert.ok(
          r.drought_probability >= 0 && r.drought_probability <= 1,
          `Drought probability must be in [0,1], got ${r.drought_probability}`
        );
      }
    });

    it('creating regime with invalid probability is rejected', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const badRegime = await request(`${PHYSICS_URL}/regimes`, {
        body: {
          name: `test_invalid_prob_${Date.now()}`,
          storm_probability: 1.5, // Invalid
        },
        headers: {
          'x-ops-role': 'test',
        },
      });

      assert.strictEqual(
        badRegime.res.status,
        400,
        'Should reject invalid probability'
      );
    });
  });

  describe('Law 4: Deterministic RNG', () => {
    it('physics events include RNG state for replay', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const events = await request(`${PHYSICS_URL}/events?limit=10`);
      assert.strictEqual(events.res.status, 200);

      const data = events.json as {
        events?: Array<{ rng_seed: string | null; rng_sequence: number | null }>
      };

      // At least some events should have RNG state
      const eventsWithRng = (data.events || []).filter(
        e => e.rng_seed !== null && e.rng_sequence !== null
      );

      // If there are tick events, they should have RNG state
      const tickEvents = (data.events || []).filter(
        (e: { event_type?: string }) => e.event_type === 'physics.tick'
      );

      if (tickEvents.length > 0) {
        assert.ok(
          eventsWithRng.length > 0,
          'Physics tick events should have RNG state'
        );
      }
    });
  });

  describe('Law 5: Admin endpoints require ops role', () => {
    it('regime creation requires x-ops-role', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const noAuth = await request(`${PHYSICS_URL}/regimes`, {
        body: {
          name: `test_no_auth_${Date.now()}`,
        },
        // No x-ops-role header
      });

      assert.strictEqual(
        noAuth.res.status,
        401,
        'Should require ops role'
      );
    });

    it('apply-regime requires x-ops-role', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const noAuth = await request(`${PHYSICS_URL}/deployments/ox-sandbox/apply-regime`, {
        body: {
          regime_name: 'calm_ice',
        },
        // No x-ops-role header
      });

      assert.strictEqual(
        noAuth.res.status,
        401,
        'Should require ops role'
      );
    });

    it('manual tick requires x-ops-role', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const noAuth = await request(`${PHYSICS_URL}/deployments/ox-sandbox/tick`, {
        method: 'POST',
        // No x-ops-role header
      });

      assert.strictEqual(
        noAuth.res.status,
        401,
        'Should require ops role'
      );
    });
  });

  describe('Law 6: Default regimes exist', () => {
    it('preset regimes are seeded', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const regimes = await request(`${PHYSICS_URL}/regimes`);
      const data = regimes.json as { regimes?: Array<{ name: string }> };
      const names = (data.regimes || []).map(r => r.name);

      assert.ok(names.includes('calm_ice'), 'Should have calm_ice regime');
      assert.ok(names.includes('storm'), 'Should have storm regime');
      assert.ok(names.includes('drought'), 'Should have drought regime');
      assert.ok(names.includes('swarm'), 'Should have swarm regime');
    });

    it('exactly one regime is default', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const regimes = await request(`${PHYSICS_URL}/regimes`);
      const data = regimes.json as { regimes?: Array<{ is_default: boolean }> };
      const defaults = (data.regimes || []).filter(r => r.is_default);

      assert.strictEqual(
        defaults.length,
        1,
        `Should have exactly one default regime, got ${defaults.length}`
      );
    });
  });

  describe('Law 7: Physics uses only physics terminology', () => {
    it('physics endpoints do not use moral language', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const endpoints = [
        `${PHYSICS_URL}/regimes`,
        `${PHYSICS_URL}/deployments`,
        `${PHYSICS_URL}/events?limit=20`,
      ];

      const moralTerms = ['bad', 'good', 'evil', 'unsafe', 'dangerous', 'prohibited', 'banned', 'punish', 'reward'];

      for (const endpoint of endpoints) {
        const response = await request(endpoint);
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
});
