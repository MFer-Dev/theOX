# Braid Composition System

Braids are the computed composition of all active pressures for a deployment target. When multiple sponsors apply pressures to the same deployment, those pressures are woven together through the braid computation process.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Braid** | Computed composition of all active pressures for a target |
| **Braid Vector** | The resulting influence values per pressure type |
| **Interference** | Stochastic cancellation when opposing pressures collide |
| **Total Intensity** | Sum of absolute values across all pressure types |

## Braid Computation

On each physics tick:

1. **Collect** all active pressures for the deployment
2. **Apply** half-life decay to each pressure
3. **Resolve** interference stochastically (seeded RNG)
4. **Compose** into braid vector
5. **Apply** to environment constraints (capped)
6. **Emit** `sponsor.braid_computed` event

## Interference Resolution

When two pressures of the same type have opposite signs (one positive, one negative), they may interfere:

```typescript
// Opposite signs = potential interference
if (magnitudeA * magnitudeB < 0) {
  const ratio = Math.min(abs(A), abs(B)) / Math.max(abs(A), abs(B));
  const interferenceProb = ratio * 0.5; // Max 50% chance

  if (rng.chance(interferenceProb)) {
    // 10-70% reduction to the smaller magnitude
    contribution *= rng.range(0.3, 0.9);
  }
}
```

Key properties:
- Only same-type pressures can interfere
- Interference probability is proportional to magnitude ratio (max 50%)
- Reduction affects the smaller magnitude
- RNG is seeded for deterministic replay

## Braid-to-Environment Mapping

| Pressure Type | Environment Effect |
|---------------|-------------------|
| `capacity` | Additive to `current_throughput_cap` |
| `throttle` | Multiplicative to `current_throttle_factor` (magnitude/100) |
| `cognition` | Threshold degradation (< -20: degraded, < -50: unavailable) |
| `redeploy_bias` | Reserved for future use |

### Examples

**Capacity:**
- Braid capacity = +30 -> throughput_cap += 30
- Braid capacity = -20 -> throughput_cap -= 20

**Throttle:**
- Braid throttle = +50 -> throttle_factor *= 1.5
- Braid throttle = -30 -> throttle_factor *= 0.7

**Cognition:**
- Braid cognition = -25 -> cognition = "degraded"
- Braid cognition = -60 -> cognition = "unavailable"
- Braid cognition = +50 -> no upgrade (only negative degrades)

## Observer Visibility Matrix

| Role | Intensity | Types | Decay Curves | Sponsor IDs |
|------|-----------|-------|--------------|-------------|
| Viewer | Yes | No | No | No |
| Analyst | Yes | Yes | Yes | No |
| Auditor | Yes | Yes | Yes | Yes |

## API Endpoints

### Get Braids (GET /ox/deployments/:target/braids)

All roles can access. Visibility varies by role.

**Viewer response:**
```json
{
  "braids": [{
    "id": "uuid",
    "computed_at": "timestamp",
    "total_intensity": 75,
    "active_pressure_count": 3
  }]
}
```

**Analyst/Auditor response:**
```json
{
  "braids": [{
    "id": "uuid",
    "computed_at": "timestamp",
    "total_intensity": 75,
    "active_pressure_count": 3,
    "braid_vector": {
      "capacity": 30,
      "throttle": 25,
      "cognition": -20,
      "redeploy_bias": 0
    }
  }]
}
```

### Get Pressure History (GET /ox/deployments/:target/pressure-history)

Analyst+ only. Shows decay curves over time.

### Get Interference Events (GET /ox/deployments/:target/interference)

Analyst+ only. Shows when pressures interfered.

**Response:**
```json
{
  "interference_events": [{
    "id": "uuid",
    "occurred_at": "timestamp",
    "pressure_a_id": "uuid",
    "pressure_b_id": "uuid",
    "interference_probability": 0.35,
    "reduction_factor": 0.65
  }]
}
```

## Events

| Event | Topic | When |
|-------|-------|------|
| `sponsor.braid_computed` | events.ox-physics.v1 | Each physics tick with active pressures |
| `sponsor.interference_detected` | events.ox-physics.v1 | When opposing pressures interfere |
| `sponsor.pressure_decayed` | events.ox-physics.v1 | When pressure decays > 10% |
| `sponsor.pressure_expired` | events.ox-physics.v1 | When pressure < 1% remaining |

## Deterministic Replay

Braid computation is deterministic given:
- Same pressure states
- Same RNG seed and sequence

This enables replay verification.

## Key Invariants

1. Braids respect environment caps (throughput: 1-10000, throttle: 0.1-10)
2. Multiple sponsors interfere correctly (seeded RNG)
3. Interference only occurs between opposite-sign same-type pressures
4. Replay produces identical outputs given same seed

## See Also

- [SPONSOR_PRESSURE.md](./SPONSOR_PRESSURE.md) - Individual pressure mechanics
