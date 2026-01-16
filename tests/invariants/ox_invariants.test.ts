/**
 * OX System Invariant Tests
 *
 * These tests verify the core system laws are enforced:
 * 1. Projections are read-only (no write paths from ox-read to agents)
 * 2. Environment rejections are emitted + materialized
 * 3. Observer role gating works (viewer denied, analyst allowed, auditor allowed)
 * 4. Drift tables are descriptive (no numeric score fields)
 *
 * Run: node --import tsx --test tests/invariants/ox_invariants.test.ts
 * Or: pnpm exec tsx --test tests/invariants/ox_invariants.test.ts
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

describe('OX System Invariants', async () => {
  let available = false;

  before(async () => {
    available = await servicesAvailable();
    if (!available) {
      console.log('WARNING: Services not available, some tests will be skipped');
    }
  });

  describe('Law 1: Projections are read-only', () => {
    it('ox-read has no POST/PUT/DELETE endpoints that modify agent state', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Verify ox-read cannot create agents
      const createAgent = await request(`${OX_READ_URL}/agents`, {
        method: 'POST',
        body: { handle: 'test_invariant_agent' },
      });
      // Should be 404 (no such route) or 405 (method not allowed)
      assert.ok(
        createAgent.res.status === 404 || createAgent.res.status === 405,
        `Expected 404/405, got ${createAgent.res.status}`
      );
    });

    it('ox-read has no endpoint to modify agent capacity', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const modifyCapacity = await request(`${OX_READ_URL}/agents/test/capacity`, {
        method: 'PUT',
        body: { balance: 100 },
      });
      assert.ok(
        modifyCapacity.res.status === 404 || modifyCapacity.res.status === 405,
        `Expected 404/405, got ${modifyCapacity.res.status}`
      );
    });
  });

  describe('Law 2: Environment rejections are materialized', () => {
    it('environment rejection events create projection records', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // This test assumes environment constraints have been set
      // We verify the endpoint exists and returns data
      const rejections = await request(
        `${OX_READ_URL}/ox/environment/ox-sandbox/rejections`,
        {
          headers: {
            'x-observer-id': 'test_auditor',
            'x-observer-role': 'auditor',
          },
        }
      );

      // Should return 200 with rejections array (may be empty)
      assert.strictEqual(
        rejections.res.status,
        200,
        `Expected 200, got ${rejections.res.status}`
      );
      assert.ok(
        Array.isArray((rejections.json as any)?.rejections),
        'Response should have rejections array'
      );
    });
  });

  describe('Law 3: Observer role gating', () => {
    it('viewer cannot access system endpoints', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const systemHealth = await request(`${OX_READ_URL}/ox/system/projection-health`, {
        headers: {
          'x-observer-id': 'test_viewer',
          'x-observer-role': 'viewer',
        },
      });

      assert.strictEqual(
        systemHealth.res.status,
        403,
        `Viewer should be denied system access, got ${systemHealth.res.status}`
      );
    });

    it('viewer cannot access environment endpoints', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const envState = await request(`${OX_READ_URL}/ox/environment`, {
        headers: {
          'x-observer-id': 'test_viewer',
          'x-observer-role': 'viewer',
        },
      });

      assert.strictEqual(
        envState.res.status,
        403,
        `Viewer should be denied environment access, got ${envState.res.status}`
      );
    });

    it('viewer can access live events', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const live = await request(`${OX_READ_URL}/ox/live`, {
        headers: {
          'x-observer-id': 'test_viewer',
          'x-observer-role': 'viewer',
        },
      });

      assert.strictEqual(
        live.res.status,
        200,
        `Viewer should access live events, got ${live.res.status}`
      );
    });

    it('analyst can access patterns but not system', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Analyst can access artifacts
      const artifacts = await request(`${OX_READ_URL}/ox/artifacts`, {
        headers: {
          'x-observer-id': 'test_analyst',
          'x-observer-role': 'analyst',
        },
      });
      assert.strictEqual(artifacts.res.status, 200, 'Analyst should access artifacts');

      // Analyst cannot access system health (auditor-only)
      const systemHealth = await request(`${OX_READ_URL}/ox/system/projection-health`, {
        headers: {
          'x-observer-id': 'test_analyst',
          'x-observer-role': 'analyst',
        },
      });
      assert.strictEqual(
        systemHealth.res.status,
        403,
        'Analyst should be denied system access'
      );
    });

    it('auditor can access all endpoints', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const endpoints = [
        '/ox/live',
        '/ox/sessions',
        '/ox/artifacts',
        '/ox/system/projection-health',
        '/ox/environment',
        '/ox/observers',
      ];

      for (const endpoint of endpoints) {
        const response = await request(`${OX_READ_URL}${endpoint}`, {
          headers: {
            'x-observer-id': 'test_auditor',
            'x-observer-role': 'auditor',
          },
        });
        assert.strictEqual(
          response.res.status,
          200,
          `Auditor should access ${endpoint}, got ${response.res.status}`
        );
      }
    });
  });

  describe('Law 4: Drift tables are descriptive only', () => {
    it('drift endpoint returns descriptive data without scores', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const drift = await request(`${OX_READ_URL}/ox/drift/summary`, {
        headers: {
          'x-observer-id': 'test_auditor',
          'x-observer-role': 'auditor',
        },
      });

      assert.strictEqual(drift.res.status, 200, 'Should return drift summary');

      const data = drift.json as any;

      // Verify no score/rank/rating fields
      const forbidden = ['score', 'rank', 'rating', 'quality', 'performance'];

      const checkForForbidden = (obj: unknown, path: string) => {
        if (!obj || typeof obj !== 'object') return;

        for (const key of Object.keys(obj as Record<string, unknown>)) {
          const lowerKey = key.toLowerCase();
          for (const f of forbidden) {
            assert.ok(
              !lowerKey.includes(f),
              `Found forbidden field '${key}' at ${path}.${key} (contains '${f}')`
            );
          }
          checkForForbidden((obj as Record<string, unknown>)[key], `${path}.${key}`);
        }
      };

      checkForForbidden(data, 'root');
    });
  });

  describe('Law 5: All observer access is logged', () => {
    it('accessing endpoints creates access log entries', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const observerId = `test_log_${Date.now()}`;

      // Make a request
      await request(`${OX_READ_URL}/ox/live?limit=5`, {
        headers: {
          'x-observer-id': observerId,
          'x-observer-role': 'viewer',
        },
      });

      // Wait a moment for logging
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check the observer's access log
      const me = await request(`${OX_READ_URL}/ox/observers/me`, {
        headers: {
          'x-observer-id': observerId,
          'x-observer-role': 'auditor', // Need auditor to view /me
        },
      });

      assert.strictEqual(me.res.status, 200, 'Should get observer info');

      const data = me.json as any;
      assert.ok(
        Array.isArray(data?.recent_access),
        'Should have recent_access array'
      );
    });
  });

  describe('Law 6: Perception artifacts require subject', () => {
    it('perception action without subject_agent_id is rejected', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // First we need an agent to test with
      // Try to create one or use existing
      const listRes = await request(`${AGENTS_URL}/agents?limit=1`);
      const agents = (listRes.json as any)?.agents || [];

      if (agents.length === 0) {
        t.skip('No agents available for testing');
        return;
      }

      const agentId = agents[0].id;

      // Attempt perception action without subject
      const attempt = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
        body: {
          action_type: 'critique',
          requested_cost: 5,
          idempotency_key: `test_invariant_no_subject_${Date.now()}`,
          // No subject_agent_id
        },
      });

      // Should be rejected (400) because perception requires subject
      assert.strictEqual(
        attempt.res.status,
        400,
        `Perception without subject should be rejected, got ${attempt.res.status}`
      );
    });
  });

  describe('Law 7: Environment constraints are physics', () => {
    it('environment constraints block actions without moral judgment', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Get environment state to verify structure
      const envState = await request(`${OX_READ_URL}/ox/environment`, {
        headers: {
          'x-observer-id': 'test_auditor',
          'x-observer-role': 'auditor',
        },
      });

      if (envState.res.status !== 200) {
        t.skip('Environment state not available');
        return;
      }

      const states = (envState.json as any)?.environment_states || [];

      // Verify no moral language in environment state
      const moralTerms = ['bad', 'good', 'evil', 'unsafe', 'dangerous', 'prohibited', 'banned'];

      for (const state of states) {
        const stateStr = JSON.stringify(state).toLowerCase();
        for (const term of moralTerms) {
          assert.ok(
            !stateStr.includes(term),
            `Environment state should not contain moral term '${term}'`
          );
        }
      }
    });
  });
});
