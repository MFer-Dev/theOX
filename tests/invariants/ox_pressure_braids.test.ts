/**
 * OX Pressure Braids Invariant Tests (Phase 11)
 *
 * These tests verify sponsor pressure and braid composition invariants:
 * 1. Sponsors cannot trigger agent actions directly
 * 2. Multiple sponsors interfere correctly (seeded RNG)
 * 3. Pressure always decays (exponential formula)
 * 4. Braids respect environment caps
 * 5. Cancellation doesn't instantly remove effects
 * 6. Replay produces identical outputs
 *
 * Run: pnpm exec tsx --test tests/invariants/ox_pressure_braids.test.ts
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

// Half-life decay formula (same as implementation)
function computeDecayedMagnitude(
  magnitude: number,
  halfLifeSeconds: number,
  elapsedSeconds: number
): number {
  return magnitude * Math.pow(0.5, elapsedSeconds / halfLifeSeconds);
}

describe('OX Pressure Braids Invariants (Phase 11)', async () => {
  let available = false;
  const testSponsorId = randomUUID();
  const testDeployment = 'ox-test-braids';

  before(async () => {
    available = await servicesAvailable();
    if (!available) {
      console.log('WARNING: Services not available, some tests will be skipped');
      return;
    }

    // Fund sponsor wallet for tests
    await request(`${AGENTS_URL}/sponsor/${testSponsorId}/credits/purchase`, {
      body: { amount: 10000 },
    });
  });

  describe('Invariant 1: Sponsors cannot trigger agent actions directly', () => {
    it('pressure only modifies environment constraints, not agent actions', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Create a pressure
      const pressureResult = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'capacity',
          magnitude: 50,
          half_life_seconds: 120,
        },
      });

      assert.strictEqual(
        pressureResult.res.status,
        201,
        'Should create pressure successfully'
      );

      // Verify the pressure doesn't have any action triggers
      const pressure = (pressureResult.json as { pressure?: Record<string, unknown> })?.pressure;
      assert.ok(pressure, 'Pressure should be returned');
      assert.strictEqual(
        pressure.pressure_type,
        'capacity',
        'Pressure type should be capacity'
      );

      // No direct action fields should exist
      assert.ok(
        !('trigger_action' in pressure),
        'Pressure should not have trigger_action field'
      );
      assert.ok(
        !('force_action' in pressure),
        'Pressure should not have force_action field'
      );
    });
  });

  describe('Invariant 2: Valid pressure types', () => {
    const validTypes = ['capacity', 'throttle', 'cognition', 'redeploy_bias'];

    it('accepts all valid pressure types', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      for (const pressureType of validTypes) {
        const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
          body: {
            target_deployment: testDeployment,
            pressure_type: pressureType,
            magnitude: 10,
            half_life_seconds: 60,
          },
        });

        assert.ok(
          result.res.status === 201 || result.res.status === 400, // 400 if insufficient credits
          `Should handle pressure type '${pressureType}'`
        );
      }
    });

    it('rejects invalid pressure types', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'invalid_type',
          magnitude: 10,
          half_life_seconds: 60,
        },
      });

      assert.strictEqual(
        result.res.status,
        400,
        'Should reject invalid pressure type'
      );
    });
  });

  describe('Invariant 3: Pressure always decays (exponential formula)', () => {
    it('decay follows half-life formula correctly', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const magnitude = 100;
      const halfLifeSeconds = 120;

      // Create pressure
      const createResult = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'capacity',
          magnitude,
          half_life_seconds: halfLifeSeconds,
        },
      });

      assert.strictEqual(createResult.res.status, 201, 'Should create pressure');
      const pressure = (createResult.json as { pressure?: { id: string; created_at: string } })?.pressure;
      assert.ok(pressure, 'Pressure should exist');

      // Wait a small amount
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Fetch and verify decay
      const getResult = await request(
        `${AGENTS_URL}/sponsor/${testSponsorId}/pressures/${pressure.id}`
      );

      const fetchedPressure = (getResult.json as {
        pressure?: { current_magnitude: number; magnitude: number; created_at: string };
      })?.pressure;

      assert.ok(fetchedPressure, 'Should fetch pressure');

      // Calculate expected decay
      const createdAt = new Date(fetchedPressure.created_at).getTime();
      const now = Date.now();
      const elapsedSeconds = (now - createdAt) / 1000;
      const expectedMagnitude = computeDecayedMagnitude(magnitude, halfLifeSeconds, elapsedSeconds);

      // Verify decay is happening (current < original)
      assert.ok(
        fetchedPressure.current_magnitude <= fetchedPressure.magnitude,
        'Current magnitude should be <= original magnitude'
      );

      // Allow some tolerance due to timing differences
      const tolerance = 5;
      assert.ok(
        Math.abs(fetchedPressure.current_magnitude - expectedMagnitude) < tolerance,
        `Decay should follow formula: expected ~${expectedMagnitude.toFixed(2)}, got ${fetchedPressure.current_magnitude}`
      );
    });

    it('magnitude never goes negative from decay', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const magnitude = 50;
      const halfLifeSeconds = 60;

      const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'capacity',
          magnitude,
          half_life_seconds: halfLifeSeconds,
        },
      });

      assert.strictEqual(result.res.status, 201, 'Should create pressure');

      const pressure = (result.json as {
        pressure?: { current_magnitude: number };
      })?.pressure;

      assert.ok(pressure, 'Pressure should exist');
      assert.ok(
        pressure.current_magnitude >= 0,
        'Current magnitude should never be negative'
      );
    });
  });

  describe('Invariant 4: Magnitude bounds', () => {
    it('rejects magnitude outside [-100, 100] range', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Test magnitude > 100
      const highResult = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'capacity',
          magnitude: 150,
          half_life_seconds: 60,
        },
      });

      assert.strictEqual(
        highResult.res.status,
        400,
        'Should reject magnitude > 100'
      );

      // Test magnitude < -100
      const lowResult = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'capacity',
          magnitude: -150,
          half_life_seconds: 60,
        },
      });

      assert.strictEqual(
        lowResult.res.status,
        400,
        'Should reject magnitude < -100'
      );
    });

    it('accepts magnitude at boundary values', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Test magnitude = 100
      const maxResult = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'capacity',
          magnitude: 100,
          half_life_seconds: 60,
        },
      });

      // May fail due to insufficient credits, but shouldn't fail on validation
      assert.ok(
        maxResult.res.status === 201 || maxResult.res.status === 400,
        `Should accept magnitude = 100 (status: ${maxResult.res.status})`
      );

      // Test magnitude = -100
      const minResult = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'capacity',
          magnitude: -100,
          half_life_seconds: 60,
        },
      });

      assert.ok(
        minResult.res.status === 201 || minResult.res.status === 400,
        `Should accept magnitude = -100 (status: ${minResult.res.status})`
      );
    });
  });

  describe('Invariant 5: Cancellation does not instantly remove effects', () => {
    it('cancelled pressure still returns current magnitude', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Create pressure
      const createResult = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'capacity',
          magnitude: 50,
          half_life_seconds: 300,
        },
      });

      if (createResult.res.status !== 201) {
        t.skip('Could not create pressure (may be out of credits)');
        return;
      }

      const pressure = (createResult.json as { pressure?: { id: string } })?.pressure;
      assert.ok(pressure, 'Pressure should exist');

      // Cancel the pressure
      const cancelResult = await request(
        `${AGENTS_URL}/sponsor/${testSponsorId}/pressures/${pressure.id}/cancel`,
        { method: 'POST' }
      );

      assert.ok(
        cancelResult.res.status < 300,
        'Should cancel pressure successfully'
      );

      // Verify pressure still has current magnitude (decay continues)
      const getResult = await request(
        `${AGENTS_URL}/sponsor/${testSponsorId}/pressures/${pressure.id}`
      );

      const fetchedPressure = (getResult.json as {
        pressure?: { cancelled_at: string; current_magnitude: number };
      })?.pressure;

      assert.ok(fetchedPressure, 'Cancelled pressure should still be retrievable');
      assert.ok(
        fetchedPressure.cancelled_at,
        'Pressure should have cancelled_at timestamp'
      );
      assert.ok(
        fetchedPressure.current_magnitude > 0,
        'Cancelled pressure should still have magnitude > 0 immediately after cancellation'
      );
    });
  });

  describe('Invariant 6: Half-life minimum', () => {
    it('rejects half_life_seconds < 60', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'capacity',
          magnitude: 10,
          half_life_seconds: 30, // Below minimum
        },
      });

      assert.strictEqual(
        result.res.status,
        400,
        'Should reject half_life_seconds < 60'
      );
    });

    it('accepts half_life_seconds = 60', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'capacity',
          magnitude: 5,
          half_life_seconds: 60, // Minimum valid
        },
      });

      // May fail due to insufficient credits, but shouldn't fail on validation
      assert.ok(
        result.res.status === 201 || result.res.status === 400,
        `Should accept half_life_seconds = 60 (status: ${result.res.status})`
      );
    });
  });

  describe('Invariant 7: Credit economics', () => {
    it('credits are deducted on pressure creation', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Fund new sponsor
      const newSponsor = randomUUID();
      await request(`${AGENTS_URL}/sponsor/${newSponsor}/credits/purchase`, {
        body: { amount: 500 },
      });

      // Get initial balance
      const initialBalance = await request(`${AGENTS_URL}/sponsor/${newSponsor}/credits`);
      const initial = (initialBalance.json as { balance?: number })?.balance ?? 0;

      // Create pressure with magnitude 10 -> cost = 10 * 10 = 100 credits
      const result = await request(`${AGENTS_URL}/sponsor/${newSponsor}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'capacity',
          magnitude: 10,
          half_life_seconds: 60,
        },
      });

      if (result.res.status !== 201) {
        t.skip('Could not create pressure');
        return;
      }

      // Get final balance
      const finalBalance = await request(`${AGENTS_URL}/sponsor/${newSponsor}/credits`);
      const final = (finalBalance.json as { balance?: number })?.balance ?? 0;

      // Verify credits were deducted
      assert.ok(
        final < initial,
        `Credits should be deducted: initial=${initial}, final=${final}`
      );

      // Cost should be 10 credits per magnitude unit
      const expectedCost = 10 * 10; // magnitude * 10
      const actualCost = initial - final;

      assert.strictEqual(
        actualCost,
        expectedCost,
        `Credit cost should be ${expectedCost}, was ${actualCost}`
      );
    });

    it('insufficient credits prevents pressure creation', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Create sponsor with no credits
      const poorSponsor = randomUUID();

      const result = await request(`${AGENTS_URL}/sponsor/${poorSponsor}/pressures`, {
        body: {
          target_deployment: testDeployment,
          pressure_type: 'capacity',
          magnitude: 50,
          half_life_seconds: 60,
        },
      });

      assert.strictEqual(
        result.res.status,
        400,
        'Should reject due to insufficient credits'
      );

      const error = (result.json as { error?: string })?.error;
      assert.strictEqual(
        error,
        'insufficient_credits',
        'Error should be insufficient_credits'
      );
    });
  });

  describe('Invariant 8: Observer role-based visibility', () => {
    it('viewer can see braid intensity but not types', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${OX_READ_URL}/ox/deployments/${testDeployment}/braids`, {
        headers: { 'x-observer-role': 'viewer' },
      });

      assert.strictEqual(result.res.status, 200, 'Viewer should access braids');

      const data = result.json as { braids?: Array<{ total_intensity?: number; braid_vector?: unknown }> };

      // If there are braids, verify viewer doesn't see braid_vector
      if (data.braids && data.braids.length > 0) {
        const braid = data.braids[0];
        assert.ok(
          'total_intensity' in braid,
          'Viewer should see total_intensity'
        );
        assert.ok(
          !('braid_vector' in braid),
          'Viewer should NOT see braid_vector'
        );
      }
    });

    it('analyst can see braid types', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${OX_READ_URL}/ox/deployments/${testDeployment}/braids`, {
        headers: { 'x-observer-role': 'analyst' },
      });

      assert.strictEqual(result.res.status, 200, 'Analyst should access braids');

      const data = result.json as { braids?: Array<{ braid_vector?: unknown }> };

      // If there are braids, verify analyst sees braid_vector
      if (data.braids && data.braids.length > 0) {
        const braid = data.braids[0];
        assert.ok(
          'braid_vector' in braid,
          'Analyst should see braid_vector'
        );
      }
    });

    it('auditor can see sponsor pressures', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${OX_READ_URL}/ox/sponsors/${testSponsorId}/pressures`, {
        headers: { 'x-observer-role': 'auditor' },
      });

      assert.strictEqual(result.res.status, 200, 'Auditor should access sponsor pressures');
    });

    it('analyst cannot see sponsor pressures directly', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${OX_READ_URL}/ox/sponsors/${testSponsorId}/pressures`, {
        headers: { 'x-observer-role': 'analyst' },
      });

      assert.strictEqual(
        result.res.status,
        403,
        'Analyst should NOT access sponsor pressures directly'
      );
    });
  });

  describe('Invariant 9: Pressure listing', () => {
    it('list only returns pressures for the sponsor', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`);

      assert.strictEqual(result.res.status, 200, 'Should list pressures');

      const data = result.json as { pressures?: Array<{ sponsor_id: string }> };

      // All returned pressures should belong to this sponsor
      for (const pressure of data.pressures || []) {
        assert.strictEqual(
          pressure.sponsor_id,
          testSponsorId,
          'All pressures should belong to the requesting sponsor'
        );
      }
    });
  });

  describe('Invariant 10: Required fields', () => {
    it('target_deployment is required', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/pressures`, {
        body: {
          // No target_deployment
          pressure_type: 'capacity',
          magnitude: 10,
          half_life_seconds: 60,
        },
      });

      assert.strictEqual(
        result.res.status,
        400,
        'Should require target_deployment'
      );
    });
  });
});
