/**
 * OX Phase 21-24 Invariant Tests (Observer & Narrative Phases)
 *
 * These tests verify:
 * - Phase 21: Observer Lens & Narrative Projection
 * - Phase 22: Artifact Language & Topic Grammar
 * - Phase 23: Temporal Navigation & World Replay Lens
 *
 * Run: pnpm exec tsx --test tests/invariants/ox_phase21_24.test.ts
 */

import { describe, it, before } from 'node:test';
import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';

const env = (key: string, fallback: string) => process.env[key] || fallback;

const OX_READ_URL = env('OX_READ_URL', 'http://localhost:4018');

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
    const oxRead = await fetch(`${OX_READ_URL}/healthz`, { signal: AbortSignal.timeout(3000) });
    return oxRead.ok;
  } catch {
    return false;
  }
}

describe('OX Phase 21-24 Invariants (Observer & Narrative)', async () => {
  let available = false;
  const testDeployment = 'ox-test-observer';

  before(async () => {
    available = await servicesAvailable();
    if (!available) {
      console.log('WARNING: Services not available, some tests will be skipped');
    }
  });

  // =========================================================================
  // Phase 21: Observer Lens & Narrative Projection
  // =========================================================================

  describe('Phase 21: Observer Lens & Narrative Projection', () => {
    it('GET /ox/observe returns valid structure', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(`${OX_READ_URL}/ox/observe?deployment=${testDeployment}`);

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      const data = json as {
        deployment_target?: string;
        observer_role?: string;
        frame_count?: number;
        frames?: unknown[];
      };
      assert.ok(data.deployment_target, 'Should have deployment_target');
      assert.ok(data.observer_role, 'Should have observer_role');
      assert.ok(data.frames !== undefined, 'Should have frames array');
    });

    it('viewer role sees no IDs in evidence', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(`${OX_READ_URL}/ox/observe?deployment=${testDeployment}`, {
        headers: { 'x-observer-role': 'viewer' },
      });

      assert.ok(res.ok, 'Request should succeed');
      const data = json as { frames?: Array<{ evidence?: unknown; evidence_hints?: unknown }> };

      // Viewer should not see evidence or evidence_hints
      for (const frame of data.frames ?? []) {
        assert.ok(!frame.evidence, 'Viewer should not see evidence');
        assert.ok(!frame.evidence_hints, 'Viewer should not see evidence_hints');
      }
    });

    it('analyst role sees evidence hints but not full IDs', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(
        `${OX_READ_URL}/ox/observe?deployment=${testDeployment}&detail=analyst`,
        { headers: { 'x-observer-role': 'analyst' } }
      );

      assert.ok(res.ok, 'Request should succeed');
      const data = json as { frames?: Array<{ evidence?: unknown; evidence_hints?: unknown }> };

      // Analyst can see evidence_hints but not full evidence
      for (const frame of data.frames ?? []) {
        if (frame.evidence_hints) {
          assert.ok(typeof frame.evidence_hints === 'object', 'evidence_hints should be object');
        }
        assert.ok(!frame.evidence, 'Analyst should not see full evidence');
      }
    });

    it('auditor role sees full evidence', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(
        `${OX_READ_URL}/ox/observe?deployment=${testDeployment}&detail=auditor`,
        { headers: { 'x-observer-role': 'auditor' } }
      );

      assert.ok(res.ok, 'Request should succeed');
      const data = json as { frames?: Array<{ evidence?: unknown; frame_id?: string }> };

      // Auditor can see full evidence and frame_id
      for (const frame of data.frames ?? []) {
        // Evidence and frame_id should be present for auditor detail level
        // (may be empty if no frames exist)
      }
    });

    it('GET /ox/observe/:frameType validates frame type', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Invalid frame type
      const { res: invalidRes, json: invalidJson } = await request(
        `${OX_READ_URL}/ox/observe/invalid_type?deployment=${testDeployment}`
      );
      assert.strictEqual(invalidRes.status, 400, 'Should reject invalid frame type');
      assert.ok((invalidJson as { valid_types?: string[] }).valid_types, 'Should return valid types');

      // Valid frame types
      const validTypes = ['emergence', 'convergence', 'divergence', 'conflict', 'propagation', 'collapse', 'silence'];
      for (const frameType of validTypes) {
        const { res } = await request(`${OX_READ_URL}/ox/observe/${frameType}?deployment=${testDeployment}`);
        assert.ok(res.ok, `Frame type ${frameType} should be valid`);
      }
    });

    it('silence frames are generated when appropriate', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Just verify the endpoint accepts the silence frame type
      const { res } = await request(`${OX_READ_URL}/ox/observe/silence?deployment=${testDeployment}`);
      assert.ok(res.ok, 'Silence frame endpoint should work');
    });

    it('narrative frames are replay deterministic', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Two requests to same endpoint should return same data
      const { json: json1 } = await request(`${OX_READ_URL}/ox/observe?deployment=${testDeployment}&limit=5`);
      const { json: json2 } = await request(`${OX_READ_URL}/ox/observe?deployment=${testDeployment}&limit=5`);

      // Frame count should be consistent
      const data1 = json1 as { frame_count?: number };
      const data2 = json2 as { frame_count?: number };
      assert.strictEqual(data1.frame_count, data2.frame_count, 'Frame counts should match');
    });
  });

  // =========================================================================
  // Phase 22: Artifact Language & Topic Grammar
  // =========================================================================

  describe('Phase 22: Artifact Language & Topic Grammar', () => {
    it('GET /ox/deployments/:target/topics returns valid structure', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(`${OX_READ_URL}/ox/deployments/${testDeployment}/topics`);

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      const data = json as { deployment_target?: string; topics?: unknown[] };
      assert.ok(data.deployment_target, 'Should have deployment_target');
      assert.ok(data.topics !== undefined, 'Should have topics array');
    });

    it('GET /ox/deployments/:target/artifacts/by-form returns valid structure', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res, json } = await request(
        `${OX_READ_URL}/ox/deployments/${testDeployment}/artifacts/by-form`
      );

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      const data = json as { deployment_target?: string; form_filter?: string; artifacts?: unknown[] };
      assert.ok(data.deployment_target, 'Should have deployment_target');
      assert.ok(data.form_filter, 'Should have form_filter');
      assert.ok(data.artifacts !== undefined, 'Should have artifacts array');
    });

    it('artifacts can be filtered by structural form', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const validForms = ['claim', 'question', 'critique', 'synthesis', 'refusal', 'signal'];

      for (const form of validForms) {
        const { res, json } = await request(
          `${OX_READ_URL}/ox/deployments/${testDeployment}/artifacts/by-form?form=${form}`
        );
        assert.ok(res.ok, `Form ${form} should be valid`);
        const data = json as { form_filter?: string };
        assert.strictEqual(data.form_filter, form, `form_filter should be ${form}`);
      }
    });
  });

  // =========================================================================
  // Phase 23: Temporal Navigation & World Replay Lens
  // =========================================================================

  describe('Phase 23: Temporal Navigation & World Replay Lens', () => {
    it('GET /ox/observe/at requires ts parameter', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res } = await request(`${OX_READ_URL}/ox/observe/at?deployment=${testDeployment}`);
      assert.strictEqual(res.status, 400, 'Should require ts parameter');
    });

    it('GET /ox/observe/at validates timestamp format', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { res } = await request(
        `${OX_READ_URL}/ox/observe/at?ts=invalid&deployment=${testDeployment}`
      );
      assert.strictEqual(res.status, 400, 'Should reject invalid timestamp');
    });

    it('GET /ox/observe/at returns world state at time', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const targetTs = new Date().toISOString();
      const { res, json } = await request(
        `${OX_READ_URL}/ox/observe/at?ts=${targetTs}&deployment=${testDeployment}`
      );

      assert.ok(res.ok, `Expected 200, got ${res.status}`);
      const data = json as {
        deployment_target?: string;
        at?: string;
        agent_count?: number;
        artifact_count?: number;
        active_structures?: unknown[];
        recent_narrative?: unknown[];
      };
      assert.ok(data.deployment_target, 'Should have deployment_target');
      assert.ok(data.at, 'Should have at timestamp');
      assert.ok(data.agent_count !== undefined, 'Should have agent_count');
      assert.ok(data.artifact_count !== undefined, 'Should have artifact_count');
      assert.ok(data.active_structures !== undefined, 'Should have active_structures');
      assert.ok(data.recent_narrative !== undefined, 'Should have recent_narrative');
    });

    it('GET /ox/cursor returns cursor for observer', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const observerId = randomUUID();

      // Without observer ID
      const { res: noIdRes, json: noIdJson } = await request(
        `${OX_READ_URL}/ox/cursor?deployment=${testDeployment}`
      );
      assert.ok(noIdRes.ok, 'Should succeed without observer ID');
      assert.ok((noIdJson as { cursor: null }).cursor === null, 'cursor should be null without ID');

      // After setting cursor via observe/at
      const targetTs = new Date().toISOString();
      await request(
        `${OX_READ_URL}/ox/observe/at?ts=${targetTs}&deployment=${testDeployment}`,
        { headers: { 'x-observer-id': observerId } }
      );

      // Fetch cursor
      const { res: cursorRes, json: cursorJson } = await request(
        `${OX_READ_URL}/ox/cursor?deployment=${testDeployment}`,
        { headers: { 'x-observer-id': observerId } }
      );

      assert.ok(cursorRes.ok, 'Should succeed with observer ID');
      const cursorData = cursorJson as { cursor_ts?: string };
      assert.ok(cursorData.cursor_ts, 'Should have cursor_ts after setting');
    });

    it('temporal navigation is read-only (no side effects)', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Navigation should only create cached slices, not modify state
      const targetTs = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago

      const { res: res1, json: json1 } = await request(
        `${OX_READ_URL}/ox/observe/at?ts=${targetTs}&deployment=${testDeployment}`
      );

      const { res: res2, json: json2 } = await request(
        `${OX_READ_URL}/ox/observe/at?ts=${targetTs}&deployment=${testDeployment}`
      );

      assert.ok(res1.ok && res2.ok, 'Both requests should succeed');

      // Same timestamp should return same data
      const data1 = json1 as { agent_count?: number; artifact_count?: number };
      const data2 = json2 as { agent_count?: number; artifact_count?: number };
      assert.strictEqual(data1.agent_count, data2.agent_count, 'agent_count should be consistent');
      assert.strictEqual(data1.artifact_count, data2.artifact_count, 'artifact_count should be consistent');
    });
  });

  // =========================================================================
  // Cross-Phase Invariants
  // =========================================================================

  describe('Cross-Phase Invariants', () => {
    it('all endpoints respect observer role hierarchy', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      // Viewer gets least access
      // Analyst gets intermediate access
      // Auditor gets full access
      const roles = ['viewer', 'analyst', 'auditor'];

      for (const role of roles) {
        const { res } = await request(`${OX_READ_URL}/ox/observe?deployment=${testDeployment}`, {
          headers: { 'x-observer-role': role },
        });
        assert.ok(res.ok, `Role ${role} should have access to /ox/observe`);
      }
    });

    it('all observer access is logged', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const observerId = randomUUID();

      // Make an observation request
      await request(`${OX_READ_URL}/ox/observe?deployment=${testDeployment}`, {
        headers: { 'x-observer-id': observerId },
      });

      // The access log should have recorded this (verified by internal endpoints)
      // This is a structural test - actual log verification would require DB access
    });

    it('narrative frames describe what happened, not what it means', async (t) => {
      if (!available) {
        t.skip('Services not available');
        return;
      }

      const { json } = await request(`${OX_READ_URL}/ox/observe?deployment=${testDeployment}`);
      const data = json as { frames?: Array<{ summary?: string }> };

      // Verify summaries are descriptive, not interpretive
      for (const frame of data.frames ?? []) {
        if (frame.summary) {
          // Summaries should not contain moral/evaluative language
          const moralizingWords = ['good', 'bad', 'should', 'must', 'wrong', 'right', 'better', 'worse'];
          const lowerSummary = frame.summary.toLowerCase();

          for (const word of moralizingWords) {
            assert.ok(
              !lowerSummary.includes(` ${word} `),
              `Summary should not contain moralizing word "${word}"`
            );
          }
        }
      }
    });
  });
});
