# OX World State Projection (Phase 6)

The World State Projection materializes physics events into observable snapshots, making the environment legible to observers. It answers: "What is the current state of the world, and what effects did it cause?"

## Core Principle: Read-Only Observation

World state projections are **read-only**. They cannot influence physics or runtime behavior. This ensures:

1. Projections remain pure observations of the system
2. Physics remains reaction-blind
3. Observers cannot game the system through observation

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   ox-physics    │────▶│     Kafka       │────▶│    ox-read      │
│  (Port 4019)    │     │                 │     │  (Port 4018)    │
│                 │     │ events.ox_      │     │                 │
│ Physics Engine  │     │ physics.v1      │     │ World State     │
│ Weather Ticks   │     │                 │     │ Projections     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         │ READ-ONLY
                                                         ▼
                                              ┌─────────────────────┐
                                              │  /ox/world          │
                                              │  /ox/world/:target  │
                                              │  /ox/world/.../hist │
                                              │  /ox/world/.../eff  │
                                              └─────────────────────┘
```

## Projection Tables

### `ox_world_state` (Current State)
Single row per deployment target, upserted on each physics tick.

| Column | Type | Description |
|--------|------|-------------|
| `deployment_target` | text (PK) | Deployment identifier |
| `regime_name` | text | Active regime name |
| `weather_state` | text | Current weather (clear/stormy/drought) |
| `vars_json` | jsonb | Physics variables snapshot |
| `updated_at` | timestamptz | Last update timestamp |
| `source_event_id` | uuid | Source physics event |

### `ox_world_state_history` (Append-Only)
Complete history of all physics ticks.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid (PK) | History record ID |
| `ts` | timestamptz | Event timestamp |
| `deployment_target` | text | Deployment identifier |
| `regime_name` | text | Regime at time of tick |
| `weather_state` | text | Weather at time of tick |
| `vars_json` | jsonb | Physics variables snapshot |
| `reason` | text | Why state changed (optional) |
| `source_event_id` | uuid (unique) | Source event for idempotency |

### `ox_world_effects_5m` (Rolling Aggregates)
5-minute buckets correlating physics state with downstream effects.

| Column | Type | Description |
|--------|------|-------------|
| `bucket_start` | timestamptz | Start of 5-minute window |
| `deployment_target` | text | Deployment identifier |
| `accepted_count` | int | Actions accepted in window |
| `rejected_count` | int | Actions rejected in window |
| `sessions_created` | int | Sessions created in window |
| `artifacts_created` | int | Artifacts created in window |
| `cognition_provider_counts` | jsonb | Count by provider |
| `avg_requested_cost` | numeric | Average action cost |
| `p95_latency_ms` | int | P95 latency (optional) |

## Observer Role Gating

Different observer roles see different levels of detail:

| Role | `/ox/world` | `/ox/world/:target` | `/ox/world/:target/history` | `/ox/world/:target/effects` |
|------|-------------|--------------------|-----------------------------|----------------------------|
| **viewer** | Summary only (no vars) | Summary only | 403 Forbidden | 403 Forbidden |
| **analyst** | + vars_json | + vars_json | Full access | Full access |
| **auditor** | + vars_json | + source_event_id | + source_event_id | Full access |

### Setting Observer Role

```bash
# Via header
curl http://localhost:4018/ox/world \
  -H "x-observer-id: my-observer" \
  -H "x-observer-role: analyst"

# Via registered observer
curl -X POST http://localhost:4018/ox/observers/register \
  -H "Content-Type: application/json" \
  -d '{"observer_id": "my-observer", "role": "analyst"}'
```

## API Endpoints

### Current World State

```bash
# Get all deployment states
GET /ox/world

# Response:
{
  "world_states": [
    {
      "deployment_target": "ox-sandbox",
      "regime_name": "calm_ice",
      "weather_state": "clear",
      "updated_at": "2024-01-15T10:30:00Z",
      "vars": { ... }  // Only for analyst/auditor
    }
  ]
}
```

### Specific Deployment State

```bash
# Get state for specific deployment
GET /ox/world/:target

# Response:
{
  "world_state": {
    "deployment_target": "ox-sandbox",
    "regime_name": "storm",
    "weather_state": "stormy",
    "updated_at": "2024-01-15T10:30:00Z",
    "vars": { ... },
    "source_event_id": "..."  // Only for auditor
  }
}
```

### State History

```bash
# Get history for deployment (analyst/auditor only)
GET /ox/world/:target/history?limit=50

# Response:
{
  "deployment_target": "ox-sandbox",
  "history": [
    {
      "id": "...",
      "ts": "2024-01-15T10:30:00Z",
      "regime_name": "storm",
      "weather_state": "stormy",
      "vars": { ... },
      "reason": "Storm weather triggered",
      "source_event_id": "..."  // Only for auditor
    }
  ]
}
```

### Rolling Effects

```bash
# Get effects aggregates (analyst/auditor only)
GET /ox/world/:target/effects?hours=6

# Response:
{
  "deployment_target": "ox-sandbox",
  "window_hours": 6,
  "aggregates": {
    "total_accepted": 150,
    "total_rejected": 23,
    "total_sessions": 12,
    "total_artifacts": 8,
    "bucket_count": 72
  },
  "buckets": [
    {
      "bucket_start": "2024-01-15T10:30:00Z",
      "accepted_count": 5,
      "rejected_count": 1,
      "sessions_created": 0,
      "artifacts_created": 0,
      "cognition_provider_counts": { "anthropic": 3 },
      "avg_requested_cost": 15.5
    }
  ]
}
```

## Materializer Logic

The world state materializer runs in `ox-read` and consumes from `events.ox_physics.v1`:

```typescript
// Kafka consumer subscribes to physics events
await runConsumer({
  groupId: 'ox-read-physics-materializer',
  topics: ['events.ox_physics.v1'],
  handler: handlePhysicsEvent,
  dlq: true,
});
```

On each physics event:

1. **Upsert** current state to `ox_world_state`
2. **Append** to `ox_world_state_history` (idempotent via `source_event_id`)
3. **Update** rolling aggregates in `ox_world_effects_5m`

## Invariants

The world state projection enforces these invariants:

1. **Read-only**: No write endpoints for world state
2. **Observer-gated**: Viewer cannot access history/effects
3. **Idempotent**: Replay-safe via `source_event_id` unique constraints
4. **Bounded**: Weather state is always valid enum
5. **Audited**: All observer access is logged

## Testing

### Run Invariant Tests

```bash
make test-world-invariants
```

### Smoke Test Endpoints

```bash
make smoke-world
```

### Seed Physics and Check Projection

```bash
# Apply storm regime and trigger tick
make seed-physics

# Check projected state
curl http://localhost:4018/ox/world/ox-sandbox \
  -H "x-observer-role: auditor"
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4018 | ox-read service port |
| (inherited) | | Physics events via Kafka |

## Example Workflow

```bash
# 1. Apply storm regime (via ox-physics)
curl -X POST http://localhost:4019/deployments/ox-sandbox/apply-regime \
  -H "x-ops-role: admin" \
  -H "Content-Type: application/json" \
  -d '{"regime_name": "storm"}'

# 2. Trigger physics tick
curl -X POST http://localhost:4019/deployments/ox-sandbox/tick \
  -H "x-ops-role: admin"

# 3. Check projected world state (via ox-read)
curl http://localhost:4018/ox/world/ox-sandbox \
  -H "x-observer-role: analyst"

# 4. View history
curl http://localhost:4018/ox/world/ox-sandbox/history \
  -H "x-observer-role: analyst"

# 5. Correlate with effects
curl http://localhost:4018/ox/world/ox-sandbox/effects?hours=1 \
  -H "x-observer-role: analyst"
```

## Integration with Other Projections

World state complements other ox-read projections:

| Projection | Purpose | Integration |
|------------|---------|-------------|
| `ox_live_events` | Raw event stream | Events include deployment_target |
| `ox_sessions` | Narrative scenes | Sessions occur within world state |
| `ox_artifacts` | Observable evidence | Artifacts created under physics conditions |
| `ox_capacity_timeline` | Economic pressure | Cost affected by throttle_factor |
| `ox_environment_states` | Axis 2 constraints | Related but distinct (imposed vs observed) |

## Running Locally

```bash
# Start infrastructure
make up

# Run migrations (includes world state tables)
make migrate

# Start services
pnpm --filter @services/ox-physics dev &
pnpm --filter @services/ox-read dev &

# Seed physics state
make seed-physics

# Verify projection
make smoke-world

# Run invariant tests
make test-world-invariants
```
