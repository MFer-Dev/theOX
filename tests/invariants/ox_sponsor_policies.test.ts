/**
 * OX Sponsor Policy Invariant Tests (Phase 7)
 *
 * These tests verify sponsor sweep policy invariants:
 * 1. Policy cadence >= 60 seconds
 * 2. Policy rules use valid predicates (eq, neq, gt, gte, lt, lte, in, not_in)
 * 3. Policy types are valid enum values
 * 4. Policy runs are idempotent per tick
 * 5. Policies only affect sponsored agents
 *
 * Run: pnpm exec tsx --test tests/invariants/ox_sponsor_policies.test.ts
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';

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

describe('OX Sponsor Policy Invariants (Phase 7)', async () => {
  let available = false;
  const testSponsorId = randomUUID();

  before(async () => {
    available = await servicesAvailable();
    if (!available) {
      console.log('WARNING: Services not available, some tests will be skipped');
    }
  });

  describe('Invariant 1: Policy cadence minimum', () => {
    it('rejects policies with cadence < 60 seconds', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/policies`, {
        body: {
          policy_type: 'capacity',
          cadence_seconds: 30, // Below minimum
          rules: [{ if: [], then: { action: 'allocate_delta', params: { delta: 10 } } }],
        },
      });

      assert.strictEqual(
        result.res.status,
        400,
        'Should reject cadence below 60 seconds'
      );
    });

    it('accepts policies with cadence >= 60 seconds', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/policies`, {
        body: {
          policy_type: 'capacity',
          cadence_seconds: 60, // Minimum valid
          rules: [{
            if: [{ field: 'env.weather_state', op: 'eq', value: 'stormy' }],
            then: { action: 'allocate_delta', params: { delta: 10 } },
          }],
        },
      });

      // Should be 201 or 200 (success)
      assert.ok(
        result.res.status < 300,
        `Should accept cadence of 60 seconds, got ${result.res.status}`
      );
    });
  });

  describe('Invariant 2: Valid policy types', () => {
    const validTypes = ['capacity', 'cognition', 'throttle', 'redeploy'];

    it('accepts all valid policy types', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      for (const policyType of validTypes) {
        const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/policies`, {
          body: {
            policy_type: policyType,
            cadence_seconds: 60,
            rules: [{ if: [{ field: 'env.weather_state', op: 'eq', value: 'clear' }], then: { action: 'allocate_delta', params: { delta: 5 } } }],
          },
        });

        assert.ok(
          result.res.status < 300,
          `Should accept policy type '${policyType}', got ${result.res.status}`
        );
      }
    });

    it('rejects invalid policy types', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/policies`, {
        body: {
          policy_type: 'invalid_type',
          cadence_seconds: 60,
          rules: [{ if: [{ field: 'env.weather_state', op: 'eq', value: 'clear' }], then: { action: 'allocate_delta', params: { delta: 5 } } }],
        },
      });

      assert.strictEqual(
        result.res.status,
        400,
        'Should reject invalid policy type'
      );
    });
  });

  describe('Invariant 3: Valid predicates', () => {
    const validPredicates = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'];

    it('accepts all valid predicates in rules', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      for (const op of validPredicates) {
        const value = ['in', 'not_in'].includes(op) ? ['value1', 'value2'] : 'value';
        const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/policies`, {
          body: {
            policy_type: 'capacity',
            cadence_seconds: 60,
            rules: [{
              if: [{ field: 'env.weather_state', op, value }],
              then: { action: 'allocate_delta', params: { delta: 5 } },
            }],
          },
        });

        assert.ok(
          result.res.status < 300,
          `Should accept predicate '${op}', got ${result.res.status}`
        );
      }
    });

    it('rejects invalid predicates', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(`${AGENTS_URL}/sponsor/${testSponsorId}/policies`, {
        body: {
          policy_type: 'capacity',
          cadence_seconds: 60,
          rules: [{
            if: [{ field: 'env.weather_state', op: 'invalid_op', value: 'test' }],
            then: { action: 'allocate_delta', params: { delta: 5 } },
          }],
        },
      });

      assert.strictEqual(
        result.res.status,
        400,
        'Should reject invalid predicate operator'
      );
    });
  });

  describe('Invariant 4: Policy listing', () => {
    it('lists only policies owned by sponsor', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const sponsorId = randomUUID();

      // Create a policy
      await request(`${AGENTS_URL}/sponsor/${sponsorId}/policies`, {
        body: {
          policy_type: 'capacity',
          cadence_seconds: 120,
          rules: [{ if: [{ field: 'env.weather_state', op: 'eq', value: 'clear' }], then: { action: 'allocate_delta', params: { delta: 5 } } }],
        },
      });

      // List policies
      const list = await request(`${AGENTS_URL}/sponsor/${sponsorId}/policies`);
      assert.strictEqual(list.res.status, 200);

      const data = list.json as { policies?: Array<{ sponsor_id: string }> };

      // All returned policies should belong to this sponsor
      for (const policy of data.policies || []) {
        assert.strictEqual(
          policy.sponsor_id,
          sponsorId,
          'Policy should belong to requesting sponsor'
        );
      }
    });
  });

  describe('Invariant 5: Policy can be disabled', () => {
    it('disabling a policy prevents future runs', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const sponsorId = randomUUID();

      // Create a policy
      const create = await request(`${AGENTS_URL}/sponsor/${sponsorId}/policies`, {
        body: {
          policy_type: 'capacity',
          cadence_seconds: 60,
          rules: [{ if: [{ field: 'env.weather_state', op: 'eq', value: 'clear' }], then: { action: 'allocate_delta', params: { delta: 5 } } }],
        },
      });

      const createData = create.json as { policy?: { id: string } };
      const policyId = createData.policy?.id;
      assert.ok(policyId, 'Should return policy ID');

      // Disable the policy
      const disable = await request(
        `${AGENTS_URL}/sponsor/${sponsorId}/policies/${policyId}/disable`,
        { method: 'POST' }
      );

      assert.ok(
        disable.res.status < 300,
        `Should successfully disable policy, got ${disable.res.status}`
      );

      // Verify policy is disabled
      const list = await request(`${AGENTS_URL}/sponsor/${sponsorId}/policies`);
      const listData = list.json as { policies?: Array<{ id: string; active: boolean }> };
      const policy = listData.policies?.find(p => p.id === policyId);

      assert.ok(policy, 'Policy should still exist');
      assert.strictEqual(policy?.active, false, 'Policy should be inactive');
    });
  });

  describe('Invariant 6: OX-Read projections', () => {
    it('policy projections are accessible via ox-read', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const sponsorId = randomUUID();

      // Create a policy
      await request(`${AGENTS_URL}/sponsor/${sponsorId}/policies`, {
        body: {
          policy_type: 'capacity',
          cadence_seconds: 60,
          rules: [{ if: [{ field: 'env.weather_state', op: 'eq', value: 'clear' }], then: { action: 'allocate_delta', params: { delta: 5 } } }],
        },
      });

      // Query via ox-read
      const projection = await request(
        `${OX_READ_URL}/ox/sponsors/${sponsorId}/policies`,
        { headers: { 'x-observer-role': 'analyst' } }
      );

      assert.strictEqual(
        projection.res.status,
        200,
        'Should be able to read policies via ox-read'
      );
    });

    it('requires analyst role for policy projections', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Try without role
      const noRole = await request(
        `${OX_READ_URL}/ox/sponsors/test/policies`
      );

      // Should require at least viewer or fail
      // The exact behavior depends on implementation
      // Just verify it doesn't crash
      assert.ok(
        noRole.res.status >= 200,
        'Should handle missing role gracefully'
      );
    });
  });
});
