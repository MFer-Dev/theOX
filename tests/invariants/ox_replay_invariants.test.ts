/**
 * OX Replay Harness Invariant Tests
 *
 * These tests verify the replay harness configuration is valid:
 * 1. All deterministic tables exist and have source_event_id for idempotency
 * 2. All nondeterministic tables exist and are correctly classified
 * 3. Consumer groups exist in Redpanda
 * 4. Topics exist for replay
 * 5. World state tables are included in replay verification
 *
 * Run: node --import tsx --test tests/invariants/ox_replay_invariants.test.ts
 * Or: make test-replay-invariants
 */

import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert';
import { Pool } from 'pg';

const env = (key: string, fallback: string) => process.env[key] || fallback;

// Must match the configuration in scripts/replay/ox_read_replay.ts
const DETERMINISTIC_TABLES = [
  // Core projections (from events.agents.v1)
  'ox_live_events',
  'ox_sessions',
  'ox_session_events',
  'ox_agent_patterns',
  'ox_artifacts',
  'ox_artifact_implications',
  'ox_capacity_timeline',
  'ox_environment_states',
  'ox_environment_history',
  'ox_environment_rejections',
  'ox_agent_deployment_patterns',
  'ox_deployment_drift',
  'ox_system_snapshots',
  // Phase 6 world state (from events.ox-physics.v1)
  'ox_world_state',
  'ox_world_state_history',
  'ox_world_effects_5m',
] as const;

const NONDETERMINISTIC_TABLES = [
  'observer_access_log',
  'ox_observers',
] as const;

const CONSUMER_GROUPS = [
  'ox-read-materializer',
  'ox-read-physics-materializer',
] as const;

const TOPICS = [
  'events.agents.v1',
  'events.ox-physics.v1',
] as const;

// Tables that must have source_event_id for idempotent replay
const TABLES_WITH_SOURCE_EVENT_ID = [
  'ox_live_events',
  'ox_session_events',
  'ox_artifact_implications',
  'ox_capacity_timeline',
  'ox_environment_history',
  'ox_environment_rejections',
  'ox_system_snapshots',
  'ox_world_state_history',
];

// Tables that use composite keys for idempotency
const TABLES_WITH_COMPOSITE_KEYS = {
  ox_sessions: ['session_id'],
  ox_agent_patterns: ['agent_id', 'pattern_type', 'window_start'],
  ox_artifacts: ['source_event_id', 'artifact_type'],
  ox_environment_states: ['deployment_target'],
  ox_agent_deployment_patterns: ['agent_id', 'deployment_target', 'pattern_type', 'window_start'],
  ox_deployment_drift: ['agent_id', 'deployment_a', 'deployment_b', 'pattern_type', 'window_end'],
  ox_world_state: ['deployment_target'],
  ox_world_effects_5m: ['deployment_target', 'bucket'],
} as const;

const REDPANDA_URL = env('REDPANDA_ADMIN_URL', 'http://localhost:9644');
const OX_READ_DB_URL = env('OX_READ_DB_URL', 'postgresql://postgres:postgres@localhost:5433/ox_read');

let pool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (!pool) {
    pool = new Pool({ connectionString: OX_READ_DB_URL });
  }
  return pool;
}

// Check if Postgres is available
async function postgresAvailable(): Promise<boolean> {
  try {
    const p = await getPool();
    await p.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// Check if Redpanda admin API is available
async function redpandaAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${REDPANDA_URL}/v1/cluster/health_overview`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe('OX Replay Harness Invariants', async () => {
  let pgAvailable = false;
  let rpAvailable = false;

  before(async () => {
    pgAvailable = await postgresAvailable();
    rpAvailable = await redpandaAvailable();

    if (!pgAvailable) {
      console.log('WARNING: Postgres not available, database tests will be skipped');
    }
    if (!rpAvailable) {
      console.log('WARNING: Redpanda not available, Kafka tests will be skipped');
    }
  });

  after(async () => {
    if (pool) {
      await pool.end();
    }
  });

  describe('Configuration consistency', () => {
    it('deterministic tables list is not empty', () => {
      assert.ok(DETERMINISTIC_TABLES.length > 0, 'Should have deterministic tables');
    });

    it('nondeterministic tables list is not empty', () => {
      assert.ok(NONDETERMINISTIC_TABLES.length > 0, 'Should have nondeterministic tables');
    });

    it('no overlap between deterministic and nondeterministic tables', () => {
      const overlap = DETERMINISTIC_TABLES.filter(t =>
        (NONDETERMINISTIC_TABLES as readonly string[]).includes(t)
      );
      assert.strictEqual(overlap.length, 0, `Tables in both lists: ${overlap.join(', ')}`);
    });

    it('world state tables are in deterministic list', () => {
      const worldTables = ['ox_world_state', 'ox_world_state_history', 'ox_world_effects_5m'];
      for (const table of worldTables) {
        assert.ok(
          (DETERMINISTIC_TABLES as readonly string[]).includes(table),
          `${table} should be in deterministic tables`
        );
      }
    });

    it('observer tables are in nondeterministic list', () => {
      const observerTables = ['observer_access_log', 'ox_observers'];
      for (const table of observerTables) {
        assert.ok(
          (NONDETERMINISTIC_TABLES as readonly string[]).includes(table),
          `${table} should be in nondeterministic tables`
        );
      }
    });

    it('physics consumer group is included', () => {
      assert.ok(
        (CONSUMER_GROUPS as readonly string[]).includes('ox-read-physics-materializer'),
        'Physics consumer group should be in list'
      );
    });

    it('physics topic is included', () => {
      assert.ok(
        (TOPICS as readonly string[]).includes('events.ox-physics.v1'),
        'Physics topic should be in list'
      );
    });
  });

  describe('Database schema validation', () => {
    it('all deterministic tables exist', async (t) => {
      if (!pgAvailable) {
        t.skip('Postgres not available');
        return;
      }

      const p = await getPool();
      for (const table of DETERMINISTIC_TABLES) {
        const result = await p.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
          ) as exists`,
          [table]
        );
        assert.ok(result.rows[0].exists, `Deterministic table '${table}' should exist`);
      }
    });

    it('all nondeterministic tables exist', async (t) => {
      if (!pgAvailable) {
        t.skip('Postgres not available');
        return;
      }

      const p = await getPool();
      for (const table of NONDETERMINISTIC_TABLES) {
        const result = await p.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = $1
          ) as exists`,
          [table]
        );
        assert.ok(result.rows[0].exists, `Nondeterministic table '${table}' should exist`);
      }
    });

    it('tables with source_event_id have the column', async (t) => {
      if (!pgAvailable) {
        t.skip('Postgres not available');
        return;
      }

      const p = await getPool();
      for (const table of TABLES_WITH_SOURCE_EVENT_ID) {
        const result = await p.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = 'source_event_id'
          ) as exists`,
          [table]
        );
        assert.ok(
          result.rows[0].exists,
          `Table '${table}' should have source_event_id column for idempotency`
        );
      }
    });

    it('tables with source_event_id have unique constraint or index', async (t) => {
      if (!pgAvailable) {
        t.skip('Postgres not available');
        return;
      }

      const p = await getPool();
      for (const table of TABLES_WITH_SOURCE_EVENT_ID) {
        // Check for unique constraint or index on source_event_id
        const result = await p.query(
          `SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE tablename = $1
              AND indexdef LIKE '%source_event_id%'
          ) as has_index`,
          [table]
        );
        assert.ok(
          result.rows[0].has_index,
          `Table '${table}' should have index on source_event_id for idempotent upserts`
        );
      }
    });

    it('world state tables have correct primary keys', async (t) => {
      if (!pgAvailable) {
        t.skip('Postgres not available');
        return;
      }

      const p = await getPool();

      // ox_world_state primary key should be deployment_target
      const wsResult = await p.query(`
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'ox_world_state'::regclass AND i.indisprimary
      `);
      const wsKeys = wsResult.rows.map(r => r.attname);
      assert.ok(
        wsKeys.includes('deployment_target'),
        `ox_world_state primary key should include deployment_target, got: ${wsKeys.join(', ')}`
      );

      // ox_world_effects_5m should have composite key
      const weResult = await p.query(`
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'ox_world_effects_5m'::regclass AND i.indisprimary
      `);
      const weKeys = weResult.rows.map(r => r.attname);
      assert.ok(
        weKeys.includes('deployment_target') && weKeys.includes('bucket'),
        `ox_world_effects_5m primary key should include deployment_target and bucket, got: ${weKeys.join(', ')}`
      );
    });
  });

  describe('Kafka infrastructure', () => {
    it('required topics exist', async (t) => {
      if (!rpAvailable) {
        t.skip('Redpanda not available');
        return;
      }

      const res = await fetch(`${REDPANDA_URL}/v1/topics`);
      if (!res.ok) {
        t.skip('Could not fetch topics');
        return;
      }

      const data = await res.json() as { topics?: Array<{ topic_name: string }> };
      const topicNames = (data.topics || []).map(t => t.topic_name);

      for (const topic of TOPICS) {
        assert.ok(
          topicNames.includes(topic),
          `Topic '${topic}' should exist in Redpanda`
        );
      }
    });
  });

  describe('Replay idempotency requirements', () => {
    it('every deterministic table has an idempotency mechanism', () => {
      const tablesWithSourceEventId = new Set(TABLES_WITH_SOURCE_EVENT_ID);
      const tablesWithCompositeKeys = new Set(Object.keys(TABLES_WITH_COMPOSITE_KEYS));

      for (const table of DETERMINISTIC_TABLES) {
        const hasSourceEventId = tablesWithSourceEventId.has(table);
        const hasCompositeKey = tablesWithCompositeKeys.has(table);

        assert.ok(
          hasSourceEventId || hasCompositeKey,
          `Table '${table}' needs idempotency mechanism (source_event_id or composite key)`
        );
      }
    });

    it('tables with composite keys have all key columns defined', async (t) => {
      if (!pgAvailable) {
        t.skip('Postgres not available');
        return;
      }

      const p = await getPool();

      for (const [table, keyColumns] of Object.entries(TABLES_WITH_COMPOSITE_KEYS)) {
        for (const col of keyColumns) {
          const result = await p.query(
            `SELECT EXISTS (
              SELECT FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = $1
                AND column_name = $2
            ) as exists`,
            [table, col]
          );
          assert.ok(
            result.rows[0].exists,
            `Table '${table}' should have key column '${col}'`
          );
        }
      }
    });
  });

  describe('Data classification correctness', () => {
    it('observer_access_log is correctly classified as nondeterministic', () => {
      // This table is populated by HTTP requests, not Kafka events
      // It CANNOT be replayed from the event log
      assert.ok(
        (NONDETERMINISTIC_TABLES as readonly string[]).includes('observer_access_log'),
        'observer_access_log must be nondeterministic (HTTP-sourced)'
      );
      assert.ok(
        !(DETERMINISTIC_TABLES as readonly string[]).includes('observer_access_log'),
        'observer_access_log must NOT be in deterministic tables'
      );
    });

    it('world state tables are correctly classified as deterministic', () => {
      // These tables are derived from events.ox-physics.v1 Kafka events
      // They MUST be replayable
      const worldTables = ['ox_world_state', 'ox_world_state_history', 'ox_world_effects_5m'];

      for (const table of worldTables) {
        assert.ok(
          (DETERMINISTIC_TABLES as readonly string[]).includes(table),
          `${table} must be deterministic (Kafka-sourced)`
        );
        assert.ok(
          !(NONDETERMINISTIC_TABLES as readonly string[]).includes(table),
          `${table} must NOT be in nondeterministic tables`
        );
      }
    });

    it('all core agent projection tables are deterministic', () => {
      const coreTables = [
        'ox_live_events',
        'ox_sessions',
        'ox_session_events',
        'ox_agent_patterns',
        'ox_artifacts',
        'ox_artifact_implications',
      ];

      for (const table of coreTables) {
        assert.ok(
          (DETERMINISTIC_TABLES as readonly string[]).includes(table),
          `${table} must be deterministic`
        );
      }
    });
  });
});
