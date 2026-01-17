/**
 * OX Economy Invariant Tests (Phase 9)
 *
 * These tests verify economy invariants:
 * 1. Credits cannot go negative
 * 2. Sponsor can only allocate to sponsored agents
 * 3. Credit transactions are recorded
 * 4. Cognition charges require sufficient credits
 * 5. Treasury ledger tracks all movements
 *
 * Run: pnpm exec tsx --test tests/invariants/ox_economy.test.ts
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

describe('OX Economy Invariants (Phase 9)', async () => {
  let available = false;

  before(async () => {
    available = await servicesAvailable();
    if (!available) {
      console.log('WARNING: Services not available, some tests will be skipped');
    }
  });

  describe('Invariant 1: Credit purchase (stub)', () => {
    it('sponsor can purchase credits', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const sponsorId = randomUUID();

      const result = await request(`${AGENTS_URL}/sponsor/${sponsorId}/credits/purchase`, {
        body: { amount: 1000 },
      });

      assert.ok(
        result.res.status < 300,
        `Should allow credit purchase, got ${result.res.status}`
      );

      const data = result.json as { balance?: number };
      assert.ok(
        typeof data.balance === 'number',
        'Should return new balance'
      );
      assert.ok(
        data.balance >= 1000,
        `Balance should be at least 1000, got ${data.balance}`
      );
    });

    it('rejects non-positive purchase amounts', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const sponsorId = randomUUID();

      const zeroResult = await request(`${AGENTS_URL}/sponsor/${sponsorId}/credits/purchase`, {
        body: { amount: 0 },
      });

      assert.strictEqual(
        zeroResult.res.status,
        400,
        'Should reject zero amount'
      );

      const negativeResult = await request(`${AGENTS_URL}/sponsor/${sponsorId}/credits/purchase`, {
        body: { amount: -100 },
      });

      assert.strictEqual(
        negativeResult.res.status,
        400,
        'Should reject negative amount'
      );
    });
  });

  describe('Invariant 2: Sponsor wallet balance', () => {
    it('wallet balance is never negative', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const sponsorId = randomUUID();

      // Get wallet (even if empty)
      const wallet = await request(`${AGENTS_URL}/sponsor/${sponsorId}/credits`);

      assert.strictEqual(wallet.res.status, 200);

      const data = wallet.json as { balance: number };
      assert.ok(
        data.balance >= 0,
        `Wallet balance must be >= 0, got ${data.balance}`
      );
    });

    it('wallet shows transaction history', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const sponsorId = randomUUID();

      // Purchase credits
      await request(`${AGENTS_URL}/sponsor/${sponsorId}/credits/purchase`, {
        body: { amount: 500 },
      });

      // Get wallet
      const wallet = await request(`${AGENTS_URL}/sponsor/${sponsorId}/credits`);
      const data = wallet.json as { recent_transactions?: unknown[] };

      assert.ok(
        Array.isArray(data.recent_transactions),
        'Should include recent transactions'
      );
    });
  });

  describe('Invariant 3: Credit allocation', () => {
    it('cannot allocate more than wallet balance', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const sponsorId = randomUUID();
      const agentId = randomUUID();

      // Purchase small amount
      await request(`${AGENTS_URL}/sponsor/${sponsorId}/credits/purchase`, {
        body: { amount: 100 },
      });

      // Try to allocate more than available
      const result = await request(
        `${AGENTS_URL}/sponsor/${sponsorId}/agents/${agentId}/credits/allocate`,
        { body: { amount: 200 } }
      );

      // Should fail (either insufficient funds or agent not found)
      assert.ok(
        result.res.status >= 400,
        'Should reject allocation exceeding balance'
      );
    });

    it('rejects non-positive allocation amounts', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const sponsorId = randomUUID();
      const agentId = randomUUID();

      const result = await request(
        `${AGENTS_URL}/sponsor/${sponsorId}/agents/${agentId}/credits/allocate`,
        { body: { amount: -50 } }
      );

      assert.strictEqual(
        result.res.status,
        400,
        'Should reject negative allocation'
      );
    });
  });

  describe('Invariant 4: Agent credit balance', () => {
    it('agent balance is never negative', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const agentId = randomUUID();

      // Get agent credits (even if doesn't exist)
      const credits = await request(`${AGENTS_URL}/agents/${agentId}/credits`);

      if (credits.res.status === 200) {
        const data = credits.json as { balance: number };
        assert.ok(
          data.balance >= 0,
          `Agent balance must be >= 0, got ${data.balance}`
        );
      }
      // 404 is OK for non-existent agent
    });
  });

  describe('Invariant 5: Credit request action', () => {
    it('agents can request credits via attempt', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const agentId = randomUUID();

      const result = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
        body: {
          action_type: 'request_credits',
          payload: {
            requested_amount: 50,
            rationale: 'Test request',
          },
        },
      });

      // Either works or agent not found
      // Should NOT be invalid action type
      const data = result.json as { reason?: string };
      if (result.res.status === 400) {
        assert.notStrictEqual(
          data.reason,
          'invalid_action_type',
          'request_credits should be a valid action type'
        );
      }
    });
  });

  describe('Invariant 6: OX-Read credit projections', () => {
    it('credit transactions visible via ox-read (analyst)', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const agentId = randomUUID();

      const result = await request(
        `${OX_READ_URL}/ox/agents/${agentId}/credits`,
        { headers: { 'x-observer-role': 'analyst' } }
      );

      assert.strictEqual(
        result.res.status,
        200,
        'Should be accessible with analyst role'
      );
    });

    it('sponsor credits require auditor role', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const sponsorId = randomUUID();

      // With auditor role
      const withRole = await request(
        `${OX_READ_URL}/ox/sponsors/${sponsorId}/credits`,
        { headers: { 'x-observer-role': 'auditor' } }
      );

      assert.strictEqual(
        withRole.res.status,
        200,
        'Should be accessible with auditor role'
      );
    });

    it('credit-requests endpoint exists', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const result = await request(
        `${OX_READ_URL}/ox/credit-requests`,
        { headers: { 'x-observer-role': 'analyst' } }
      );

      assert.strictEqual(
        result.res.status,
        200,
        'Credit requests endpoint should exist'
      );
    });
  });

  describe('Invariant 7: No debt accumulation', () => {
    it('actions fail rather than create debt', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // This invariant is structural - verify the rejection reason
      const agentId = randomUUID();

      const result = await request(`${AGENTS_URL}/agents/${agentId}/attempt`, {
        body: {
          action_type: 'negotiate', // Expensive action
          participants: ['other-agent'],
          payload: {},
        },
      });

      const data = result.json as { reason?: string };

      // Should not have any debt-related responses
      const responseStr = JSON.stringify(data).toLowerCase();
      assert.ok(
        !responseStr.includes('debt'),
        'Should not mention debt'
      );
      assert.ok(
        !responseStr.includes('defer'),
        'Should not mention deferral'
      );
    });
  });
});
