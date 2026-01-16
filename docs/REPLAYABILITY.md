# OX Replayability

This document explains how to verify that OX projections are deterministic and replay-safe.

## Why Replayability Matters

Projections are derived views of events. If they drift on replay:

- Historical analysis becomes unreliable
- Debugging becomes impossible
- The system cannot be trusted as evidence

The OX enforces **Law 2: Projections Are Append-Only and Replay-Safe**.

## The Replay Harness

The replay harness proves projection determinism by:

1. Snapshotting current projection state (row counts, checksums)
2. Truncating projection tables
3. Resetting Kafka consumer offset to earliest
4. Re-materializing projections from events
5. Comparing new state to original snapshot

### Running the Replay Harness

```bash
# Prerequisite: services must be running
make dev

# Run replay verification
make replay-ox
```

Or directly:

```bash
pnpm exec tsx scripts/replay/ox_read_replay.ts
```

### Expected Output

Success:

```
==========================================================
REPLAY SUCCESS: All projections match
==========================================================

Duration: 12345ms
```

Failure:

```
==========================================================
REPLAY FAILED: Projections differ
==========================================================

Differences:
  ox_live_events: 1000 -> 998 (delta: -2)
  ox_artifacts: 50 -> 52 (delta: +2)
```

### What Failure Means

If replay fails, one of these is true:

1. **Non-idempotent projection logic:** An event is being processed differently on replay
2. **Missing `ON CONFLICT` handling:** Duplicate inserts are failing
3. **Time-dependent logic:** Projections depend on wall-clock time, not event time
4. **External state dependency:** Projections depend on state outside the event stream

### Debugging Replay Failures

1. Check the diff report for which tables diverged
2. Look for recent changes to projection handlers in `ox-read/src/index.ts`
3. Verify all inserts use `ON CONFLICT (source_event_id) DO NOTHING` or similar
4. Ensure timestamps come from `event.occurred_at`, not `new Date()`

## Projection Tables

The following tables are replay-verified:

| Table | Purpose | Idempotency Key |
|-------|---------|-----------------|
| `ox_live_events` | Live event stream | `source_event_id` |
| `ox_sessions` | Session boundaries | `session_id` |
| `ox_session_events` | Events in sessions | `source_event_id` |
| `ox_agent_patterns` | Agent behavior patterns | `(agent_id, pattern_type, window_start)` |
| `ox_artifacts` | Derived artifacts | `(source_event_id, artifact_type)` |
| `ox_artifact_implications` | Inter-agent perception | `source_event_id` |
| `ox_capacity_timeline` | Economic pressure | `source_event_id` |
| `ox_environment_states` | Current environment | `deployment_target` |
| `ox_environment_history` | Environment changes | `source_event_id` |
| `ox_environment_rejections` | Environment rejections | `source_event_id` |
| `ox_agent_deployment_patterns` | Per-deployment patterns | `(agent_id, deployment_target, pattern_type, window_start)` |
| `ox_deployment_drift` | Cross-deployment drift | `(agent_id, deployment_a, deployment_b, pattern_type, window_end)` |

## Preserved Tables

These tables are NOT truncated during replay:

| Table | Reason |
|-------|--------|
| `consumer_offsets` | Needed to track replay progress |

## Best Practices for Projection Code

### DO

```typescript
// Use event ID for idempotency
await pool.query(
  `INSERT INTO ox_live_events (..., source_event_id)
   VALUES (..., $1)
   ON CONFLICT (source_event_id) DO NOTHING`,
  [event.event_id]
);

// Use event time, not wall time
const eventTs = new Date(event.occurred_at);
```

### DON'T

```typescript
// Don't use wall clock time
const now = new Date(); // BAD

// Don't insert without conflict handling
await pool.query(
  `INSERT INTO ox_live_events (...) VALUES (...)` // BAD - will fail on replay
);

// Don't depend on insertion order
const id = await pool.query('SELECT max(id) FROM ...'); // BAD
```

## Automated Verification

The replay harness runs as part of CI:

```yaml
# .github/workflows/ci.yml
- name: Replay verification
  run: make replay-ox
```

## Troubleshooting

### "Consumer group not found"

The consumer group hasn't started yet. Start ox-read and wait for it to process some events.

### "Timeout waiting for consumer"

The consumer is taking too long to reprocess. Check:
- Is ox-read running?
- Are there many events to replay?
- Is Redpanda healthy?

### "Table does not exist"

Run migrations first: `make migrate`
