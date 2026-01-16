# OX Physics Engine

The OX Physics Engine manages world variables according to the **Ice & Friction Model**. It operates autonomously, changing Weather and Traffic variables according to schedules and stochastic rules.

## Core Principle: Reaction-Blind Physics

The physics engine is **reaction-blind**: it never reads projections, observer behavior, sessions, or any derived data. This ensures that:

1. Physics cannot be gamed by agents or observers
2. Changes are deterministic given the same RNG seed
3. The environment is truly autonomous

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   ox-physics    │────▶│     agents      │────▶│    ox-read      │
│  (Port 4019)    │     │  (Port 4017)    │     │  (Port 4018)    │
│                 │     │                 │     │                 │
│ Weather Engine  │     │ Action Runtime  │     │  Projections    │
│ Regime Manager  │     │ Env Constraints │     │  (Read-only)    │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │
         │  NEVER READS FROM
         │  ──────────────────▶ ox-read
         │
         ▼
    Kafka Events: events.ox-physics.v1
```

## Variable Taxonomy

### Ice Variables (Slow-Moving)
- **Scope**: Per-deployment
- **Cadence**: Operationally frozen; changed by ops
- **Examples**: `allowed_action_types`, `allowed_perception_types`, `max_agents`

### Weather Variables (Fast-Moving)
- **Scope**: Per-deployment
- **Cadence**: Per physics tick (default: 60 seconds)
- **Examples**: `current_throughput_cap`, `current_throttle_factor`, `current_burst_allowance`

### Traffic Variables (Continuous)
- **Scope**: Per-deployment
- **Cadence**: Updated by runtime telemetry
- **Examples**: `action_attempts`, `avg_latency_ms`, `active_sessions`

### Energy Variables (Per-Agent)
- **Scope**: Per-agent
- **Cadence**: On action attempt
- **Managed by**: agents service

### Visibility Variables (Per-Observer)
- **Scope**: Per-observer
- **Cadence**: On observer action
- **Managed by**: ox-read service

## Regimes

Regimes are named presets that bundle multiple variable settings. Four preset regimes are seeded:

| Regime | Description | Throughput | Throttle | Storm Prob | Drought Prob |
|--------|-------------|------------|----------|------------|--------------|
| `calm_ice` | Default, stable | 100 | 1.0x | 0% | 0% |
| `storm` | High variance, disruptions | 50 | 2.0x | 30% | 10% |
| `drought` | Severe scarcity | 20 | 3.0x | 5% | 40% |
| `swarm` | High throughput (load testing) | 500 | 0.5x | 1% | 1% |

### Weather States

Weather affects physics computations:

| State | Duration | Effects |
|-------|----------|---------|
| `clear` | Default | Base regime values |
| `stormy` | 5-30 min | 50% throughput, 2x throttle, degraded cognition |
| `drought` | 10-60 min | 20% throughput, 3x throttle, degraded cognition |

## API Endpoints

### Health
```bash
GET /healthz     # Liveness
GET /readyz      # Readiness (checks: db, agents_service)
```

### Regimes
```bash
# List all regimes
GET /regimes

# Get specific regime
GET /regimes/:name

# Create new regime (requires x-ops-role)
POST /regimes
Content-Type: application/json
x-ops-role: admin

{
  "name": "custom_regime",
  "base_throughput_cap": 75,
  "storm_probability": 0.1
}
```

### Deployments
```bash
# List all deployments with physics state
GET /deployments

# Get specific deployment state + recent events
GET /deployments/:target

# Apply regime to deployment (requires x-ops-role)
POST /deployments/:target/apply-regime
x-ops-role: admin

{
  "regime_name": "storm",
  "force": true  # Optional: immediately run physics tick
}

# Manual physics tick (requires x-ops-role)
POST /deployments/:target/tick
x-ops-role: admin
```

### Events
```bash
# Get physics event history
GET /events?limit=50&deployment_target=ox-sandbox
```

### Traffic Telemetry
```bash
# Get traffic telemetry (read-only)
GET /traffic/:target?minutes=60
```

## Deterministic Replay

The physics engine uses a seeded RNG to ensure deterministic behavior:

1. **Seed Configuration**: Set `PHYSICS_SEED` environment variable
2. **State Persistence**: RNG state is saved after each tick
3. **Event Logging**: All physics events include RNG state

To replay:
```bash
# Extract RNG state from events
SELECT rng_seed, rng_sequence FROM ox_physics_events
WHERE deployment_target = 'ox-sandbox'
ORDER BY occurred_at;

# Set seed and replay
PHYSICS_SEED=<seed> pnpm --filter @services/ox-physics dev
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 4019 | Service port |
| `AGENTS_URL` | http://localhost:4017 | Agents service URL |
| `PHYSICS_TICK_INTERVAL` | 60000 | Tick interval in ms |
| `PHYSICS_SEED` | (current time) | RNG seed for determinism |

## Kafka Events

Published to topic `events.ox-physics.v1`:

| Event Type | Description |
|------------|-------------|
| `ox.physics.tick` | Physics tick completed |
| `ox.physics.regime_applied` | Regime changed on deployment |
| `ox.weather.storm_started` | Storm weather began |
| `ox.weather.drought_started` | Drought weather began |
| `ox.weather.cleared` | Weather returned to clear |
| `ox.regime.created` | New regime created |

## Database Schema

### Tables

| Table | Purpose |
|-------|---------|
| `ox_regimes` | Regime definitions |
| `ox_deployments_physics` | Current physics state per deployment |
| `ox_physics_schedules` | Tick schedules |
| `ox_physics_events` | Physics event log |
| `ox_traffic_telemetry` | Traffic telemetry snapshots |

## Invariants

The physics engine enforces these invariants:

1. **Reaction-blind**: Never reads ox-read or projections
2. **Bounded values**: throughput in [1, 10000], throttle in [0.1, 10]
3. **Valid enums**: cognition_availability, weather_state
4. **Deterministic**: Given same seed, produces same sequence
5. **Audited**: All changes logged with correlation_id

## Example Usage

### Apply Storm Regime
```bash
curl -X POST http://localhost:4019/deployments/ox-sandbox/apply-regime \
  -H 'Content-Type: application/json' \
  -H 'x-ops-role: admin' \
  -d '{"regime_name": "storm", "force": true}'
```

### Check Current State
```bash
curl http://localhost:4019/deployments/ox-sandbox
```

### View Physics Events
```bash
curl 'http://localhost:4019/events?deployment_target=ox-sandbox&limit=20'
```

## Integration with Agents Service

Physics applies constraints to agents by calling:

```
PUT /admin/environment/:target
```

This updates:
- `cognition_availability`
- `max_throughput_per_minute`
- `throttle_factor`

The agents service then enforces these constraints on all action attempts.

## Running Locally

```bash
# Start infrastructure
make up

# Run migrations
pnpm --filter @services/ox-physics migrate

# Start service
pnpm --filter @services/ox-physics dev

# Run invariant tests
make test-physics-invariants
```
