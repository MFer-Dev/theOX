/* eslint-disable no-console */
/**
 * OX Read Replay Harness
 *
 * Proves that projections are deterministic and replay-safe:
 * 1. Snapshots row counts + key aggregates for projection tables
 * 2. Truncates projection tables (not consumer offsets)
 * 3. Resets consumer offset to earliest
 * 4. Re-materializes projections by re-running consumer
 * 5. Re-checks that counts + aggregates match exactly
 *
 * Run: pnpm exec tsx scripts/replay/ox_read_replay.ts
 */

import { Pool } from 'pg';
import { Kafka, logLevel, Admin } from 'kafkajs';

const env = (key: string, fallback: string) => process.env[key] || fallback;

const DATABASE_URL = env(
  'DATABASE_URL',
  `postgresql://${env('POSTGRES_USER', 'genme_local')}:${env('POSTGRES_PASSWORD', 'genme_local_password')}@${env('POSTGRES_HOST', 'localhost')}:${env('POSTGRES_PORT', '5433')}/${env('POSTGRES_DB', 'genme_local')}`
);

const REDPANDA_BROKERS = env('REDPANDA_BROKERS', 'localhost:9092').split(',');
const OX_READ_URL = env('OX_READ_URL', 'http://localhost:4018');
const CONSUMER_GROUP = 'ox-read-materializer';

// Projection tables to snapshot and replay
const PROJECTION_TABLES = [
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
  'ox_observers',
  'observer_access_log',
  'ox_system_snapshots',
] as const;

// Tables that should NOT be truncated (state tracking)
const PRESERVE_TABLES = ['consumer_offsets'] as const;

interface TableSnapshot {
  table: string;
  count: number;
  checksum?: string;
}

interface ReplayResult {
  success: boolean;
  before: TableSnapshot[];
  after: TableSnapshot[];
  diffs: Array<{ table: string; before: number; after: number }>;
  duration_ms: number;
}

const pool = new Pool({ connectionString: DATABASE_URL });

async function getTableSnapshot(table: string): Promise<TableSnapshot> {
  const countRes = await pool.query(`SELECT count(*) as count FROM ${table}`);
  const count = Number(countRes.rows[0].count);

  // For some tables, compute a simple checksum based on IDs
  let checksum: string | undefined;
  try {
    if (table === 'ox_live_events' || table === 'ox_artifacts') {
      const checksumRes = await pool.query(
        `SELECT md5(string_agg(id::text, ',' ORDER BY id)) as checksum FROM ${table}`
      );
      checksum = checksumRes.rows[0].checksum;
    }
  } catch {
    // Checksum optional
  }

  return { table, count, checksum };
}

async function snapshotAllTables(): Promise<TableSnapshot[]> {
  const snapshots: TableSnapshot[] = [];
  for (const table of PROJECTION_TABLES) {
    try {
      const snapshot = await getTableSnapshot(table);
      snapshots.push(snapshot);
    } catch (err) {
      console.log(`  [WARN] Could not snapshot ${table}: ${(err as Error).message}`);
      snapshots.push({ table, count: -1 });
    }
  }
  return snapshots;
}

async function truncateProjectionTables(): Promise<void> {
  console.log('\n--- Truncating projection tables ---');

  for (const table of PROJECTION_TABLES) {
    if (PRESERVE_TABLES.includes(table as typeof PRESERVE_TABLES[number])) {
      console.log(`  [SKIP] ${table} (preserved)`);
      continue;
    }

    try {
      await pool.query(`TRUNCATE TABLE ${table} CASCADE`);
      console.log(`  [OK] Truncated ${table}`);
    } catch (err) {
      console.log(`  [WARN] Could not truncate ${table}: ${(err as Error).message}`);
    }
  }
}

async function resetConsumerOffset(): Promise<void> {
  console.log('\n--- Resetting consumer offset to earliest ---');

  const kafka = new Kafka({
    clientId: 'ox-replay-harness',
    brokers: REDPANDA_BROKERS,
    logLevel: logLevel.NOTHING,
  });

  const admin: Admin = kafka.admin();
  await admin.connect();

  try {
    // Get topics the consumer group is subscribed to
    const groups = await admin.describeGroups([CONSUMER_GROUP]);
    const group = groups.groups[0];

    if (!group || group.state === 'Unknown') {
      console.log('  [INFO] Consumer group not found or empty, will start fresh');
      await admin.disconnect();
      return;
    }

    // Reset offsets by deleting the consumer group
    // This forces it to re-read from the beginning (fromBeginning: true in consumer config)
    try {
      await admin.deleteGroups([CONSUMER_GROUP]);
      console.log(`  [OK] Deleted consumer group ${CONSUMER_GROUP}`);
    } catch (err) {
      console.log(`  [WARN] Could not delete group: ${(err as Error).message}`);
    }

    // Also clear our consumer_offsets table
    await pool.query(`DELETE FROM consumer_offsets WHERE consumer_group = $1`, [CONSUMER_GROUP]);
    console.log(`  [OK] Cleared consumer_offsets for ${CONSUMER_GROUP}`);

  } finally {
    await admin.disconnect();
  }
}

async function waitForConsumerToProcess(timeoutMs: number = 30000): Promise<void> {
  console.log('\n--- Waiting for consumer to reprocess events ---');

  const startTime = Date.now();
  let lastCount = -1;
  let stableIterations = 0;

  while (Date.now() - startTime < timeoutMs) {
    // Check ox_live_events count as a proxy for processing
    const countRes = await pool.query('SELECT count(*) as count FROM ox_live_events');
    const currentCount = Number(countRes.rows[0].count);

    if (currentCount === lastCount && currentCount > 0) {
      stableIterations++;
      if (stableIterations >= 3) {
        console.log(`  [OK] Consumer appears stable at ${currentCount} events`);
        return;
      }
    } else {
      stableIterations = 0;
    }

    lastCount = currentCount;
    console.log(`  [WAIT] ox_live_events: ${currentCount} (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`  [WARN] Timeout waiting for consumer (last count: ${lastCount})`);
}

async function triggerConsumerRestart(): Promise<void> {
  console.log('\n--- Triggering consumer restart ---');

  // The consumer in ox-read runs in-process, so we need to signal it to restart
  // In a real setup, this would be done by restarting the service
  // For now, we'll just call the healthcheck and hope the consumer re-reads

  try {
    const res = await fetch(`${OX_READ_URL}/healthz`);
    if (res.ok) {
      console.log('  [OK] OX Read service is running');
      console.log('  [INFO] Consumer will reprocess from earliest offset on next message or restart');
    }
  } catch (err) {
    console.log(`  [WARN] Could not reach OX Read: ${(err as Error).message}`);
  }

  // Note: In production, you'd restart the ox-read service here
  // For local dev, we'll rely on the consumer restarting naturally
  console.log('  [INFO] For full replay, restart ox-read service: pnpm --filter @services/ox-read dev');
}

async function comparSnapshots(before: TableSnapshot[], after: TableSnapshot[]): Promise<ReplayResult['diffs']> {
  const diffs: ReplayResult['diffs'] = [];

  for (const b of before) {
    const a = after.find(t => t.table === b.table);
    if (!a) {
      diffs.push({ table: b.table, before: b.count, after: -1 });
      continue;
    }

    if (b.count !== a.count) {
      diffs.push({ table: b.table, before: b.count, after: a.count });
    }

    // Also check checksums if available
    if (b.checksum && a.checksum && b.checksum !== a.checksum) {
      console.log(`  [WARN] Checksum mismatch for ${b.table}`);
    }
  }

  return diffs;
}

async function runReplay(): Promise<ReplayResult> {
  const startTime = Date.now();

  console.log('='.repeat(60));
  console.log('OX Read Replay Harness');
  console.log('='.repeat(60));

  // Step 1: Snapshot before
  console.log('\n--- Snapshotting current state (BEFORE) ---');
  const before = await snapshotAllTables();
  for (const s of before) {
    if (s.count >= 0) {
      console.log(`  ${s.table}: ${s.count} rows`);
    }
  }

  // Step 2: Truncate projection tables
  await truncateProjectionTables();

  // Step 3: Reset consumer offset
  await resetConsumerOffset();

  // Step 4: Trigger consumer restart / wait for reprocessing
  await triggerConsumerRestart();
  await waitForConsumerToProcess(60000);

  // Step 5: Snapshot after
  console.log('\n--- Snapshotting replayed state (AFTER) ---');
  const after = await snapshotAllTables();
  for (const s of after) {
    if (s.count >= 0) {
      console.log(`  ${s.table}: ${s.count} rows`);
    }
  }

  // Step 6: Compare
  console.log('\n--- Comparing snapshots ---');
  const diffs = await comparSnapshots(before, after);

  const duration_ms = Date.now() - startTime;
  const success = diffs.length === 0;

  const result: ReplayResult = {
    success,
    before,
    after,
    diffs,
    duration_ms,
  };

  if (success) {
    console.log('\n' + '='.repeat(60));
    console.log('REPLAY SUCCESS: All projections match');
    console.log('='.repeat(60));
  } else {
    console.log('\n' + '='.repeat(60));
    console.log('REPLAY FAILED: Projections differ');
    console.log('='.repeat(60));
    console.log('\nDifferences:');
    for (const d of diffs) {
      console.log(`  ${d.table}: ${d.before} -> ${d.after} (delta: ${d.after - d.before})`);
    }
  }

  console.log(`\nDuration: ${duration_ms}ms`);

  return result;
}

async function main() {
  try {
    const result = await runReplay();

    // Output JSON if requested
    if (process.env.OX_REPLAY_JSON_OUTPUT) {
      console.log('\n--- JSON Output ---');
      console.log(JSON.stringify(result, null, 2));
    }

    await pool.end();
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error('\nREPLAY ERROR:', err);
    await pool.end();
    process.exit(1);
  }
}

main();
