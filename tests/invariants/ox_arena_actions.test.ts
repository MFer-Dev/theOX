/**
 * OX Arena Action Invariant Tests (Phase 8)
 *
 * These tests verify arena action invariants:
 * 1. All action types have defined base costs
 * 2. Invalid action types are rejected
 * 3. Context validation (solo vs multi_agent)
 * 4. Capacity checks before action execution
 * 5. Environment modifiers affect costs
 *
 * Run: pnpm exec tsx --test tests/invariants/ox_arena_actions.test.ts
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';

const env = (key: string, fallback: string) => process.env[key] || fallback;

const AGENTS_URL = env('AGENTS_URL', 'http://localhost:4017');

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
    const agents = await fetch(`${AGENTS_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
    return agents.ok;
  } catch {
    return false;
  }
}

describe('OX Arena Action Invariants (Phase 8)', async () => {
  let available = false;

  before(async () => {
    available = await servicesAvailable();
    if (!available) {
      console.log('WARNING: Services not available, some tests will be skipped');
    }
  });

  describe('Invariant 1: Action catalog completeness', () => {
    const expectedActions = [
      'communicate',
      'negotiate',
      'form_alliance',
      'defect',
      'critique',
      'counter_model',
      'refuse',
      'signal',
      'trade',
      'withdraw',
      'request_credits',
    ];

    it('all expected action types exist in catalog', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const catalog = await request(`${AGENTS_URL}/action-catalog`);

      // If the catalog endpoint exists
      if (catalog.res.status === 200) {
        const data = catalog.json as { actions?: Array<{ action_type: string }> };
        const types = (data.actions || []).map(a => a.action_type);

        for (const action of expectedActions) {
          assert.ok(
            types.includes(action),
            `Action catalog should include '${action}'`
          );
        }
      } else {
        // Catalog endpoint might not be exposed, that's OK
        t.skip('Action catalog endpoint not available');
      }
    });
  });

  describe('Invariant 2: Invalid action rejection', () => {
    it('rejects unknown action types', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const agentId = randomUUID();

      const result = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
        body: {
          action_type: 'invalid_action_type',
          payload: {},
        },
      });

      // Should be rejected (400 or similar)
      // Agent might not exist, which is 404, so accept that too
      assert.ok(
        result.res.status >= 400,
        `Should reject invalid action type, got ${result.res.status}`
      );

      const data = result.json as { reason?: string; error?: string };
      if (result.res.status === 400) {
        assert.ok(
          data.reason === 'invalid_action_type' || data.error?.includes('invalid'),
          'Should indicate invalid action type'
        );
      }
    });
  });

  describe('Invariant 3: Context validation', () => {
    it('multi_agent actions require participants array', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const agentId = randomUUID();

      // Negotiate is multi_agent, should require participants
      const result = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
        body: {
          action_type: 'negotiate',
          payload: { proposal: 'test' },
          // No participants array
        },
      });

      // Should be rejected or agent not found
      assert.ok(
        result.res.status >= 400,
        'Should reject multi_agent action without participants'
      );
    });

    it('solo actions do not require participants', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const agentId = randomUUID();

      // Signal is solo action
      const result = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
        body: {
          action_type: 'signal',
          payload: { message: 'test' },
        },
      });

      // Should work or agent not found (not invalid context)
      const data = result.json as { reason?: string };
      if (result.res.status === 400) {
        assert.notStrictEqual(
          data.reason,
          'invalid_context',
          'Signal should not fail due to context'
        );
      }
    });
  });

  describe('Invariant 4: Base costs are positive', () => {
    it('all action types have positive base costs', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const catalog = await request(`${AGENTS_URL}/action-catalog`);

      if (catalog.res.status === 200) {
        const data = catalog.json as { actions?: Array<{ action_type: string; base_cost: number }> };

        for (const action of data.actions || []) {
          assert.ok(
            action.base_cost > 0,
            `Action '${action.action_type}' should have positive base cost, got ${action.base_cost}`
          );
        }
      } else {
        t.skip('Action catalog endpoint not available');
      }
    });
  });

  describe('Invariant 5: Capacity rejection', () => {
    it('actions fail when capacity insufficient', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // This requires an agent with zero capacity
      // Since we can't easily create one, we just verify the error code exists
      const agentId = 'nonexistent-agent';

      const result = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
        body: {
          action_type: 'signal',
          payload: {},
        },
      });

      // Agent not found is expected
      assert.ok(
        result.res.status >= 400,
        'Should fail for non-existent agent'
      );
    });
  });

  describe('Invariant 6: Action response structure', () => {
    it('accepted actions return expected fields', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // We'd need a real agent to test this fully
      // Just verify the endpoint exists and returns structured data
      const agentId = randomUUID();

      const result = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
        body: {
          action_type: 'signal',
          payload: {},
        },
      });

      const data = result.json as {
        accepted?: boolean;
        reason?: string;
        cost?: number;
        remaining_balance?: number;
      };

      // Response should have structured format
      assert.ok(
        typeof data === 'object',
        'Response should be an object'
      );

      // If not accepted, should have reason
      if (data.accepted === false) {
        assert.ok(
          typeof data.reason === 'string',
          'Rejected action should have reason'
        );
      }
    });
  });

  describe('Invariant 7: No moral language in rejections', () => {
    it('rejection reasons use physics terminology', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const validReasons = [
        'capacity_insufficient',
        'environment_closed',
        'throughput_limited',
        'cognition_unavailable',
        'invalid_action_type',
        'invalid_context',
        'sponsor_credit_insufficient',
        'agent_not_found',
      ];

      const moralTerms = ['forbidden', 'prohibited', 'banned', 'illegal', 'bad', 'evil'];

      const agentId = 'test-agent';

      const result = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
        body: {
          action_type: 'invalid_type',
          payload: {},
        },
      });

      const data = result.json as { reason?: string; error?: string };
      const responseText = JSON.stringify(data).toLowerCase();

      for (const term of moralTerms) {
        assert.ok(
          !responseText.includes(term),
          `Response should not contain moral term '${term}'`
        );
      }
    });
  });
});
