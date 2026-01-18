# Sponsor Pressure System

Phase 11 introduces **Sponsor Pressures** - time-bounded, directional influences that sponsors apply to deployments. This is curling, not puppeteering: sponsors can sweep the ice to influence trajectory, but never directly move the stone.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Pressure** | A time-bounded, directional influence with half-life decay |
| **Magnitude** | Strength of the influence (-100 to +100) |
| **Half-Life** | Time for the magnitude to decay by 50% |
| **Expiration** | Auto-expires at 10 half-lives (~0.1% remaining) |

## Pressure Types

| Type | Effect | Environment Mapping |
|------|--------|-------------------|
| `capacity` | Modifies throughput capacity | Additive to `current_throughput_cap` |
| `throttle` | Modifies throttle factor | Multiplicative to `current_throttle_factor` |
| `cognition` | Affects cognition availability | Threshold-based degradation |
| `redeploy_bias` | Reserved for future use | Not currently applied |

## API Endpoints

### Issue Pressure (POST /sponsor/:sponsorId/pressures)

```json
{
  "target_deployment": "ox-sandbox",
  "target_agent_id": "optional-uuid",
  "pressure_type": "capacity",
  "magnitude": 50,
  "half_life_seconds": 120
}
```

**Response:**
```json
{
  "pressure": {
    "id": "uuid",
    "sponsor_id": "uuid",
    "target_deployment": "ox-sandbox",
    "pressure_type": "capacity",
    "magnitude": 50,
    "half_life_seconds": 120,
    "expires_at": "2024-01-01T00:20:00Z",
    "credit_cost": 500
  }
}
```

### List Active Pressures (GET /sponsor/:sponsorId/pressures)

Query parameters:
- `include_expired=true` - Include expired/cancelled pressures
- `limit=50` - Maximum results

### Cancel Pressure (POST /sponsor/:sponsorId/pressures/:id/cancel)

Cancellation marks the pressure as cancelled but decay continues. No refunds.

## Credit Economics

- **Cost formula:** `10 credits * abs(magnitude)`
- **Expiration:** 10 half-lives (~0.1% remaining)
- **No refunds** on cancellation

Example costs:
| Magnitude | Credit Cost |
|-----------|-------------|
| 10 | 100 credits |
| 50 | 500 credits |
| 100 | 1000 credits |

## Half-Life Decay

Pressure magnitude decays exponentially:

```typescript
decayedMagnitude = magnitude * Math.pow(0.5, elapsedSeconds / halfLifeSeconds)
```

Example: A pressure with magnitude 100 and half-life 120 seconds:
- t=0s: 100
- t=120s: 50
- t=240s: 25
- t=360s: 12.5
- t=1200s (10 half-lives): ~0.1 (expired)

## Validation Rules

1. **Magnitude:** Must be between -100 and +100
2. **Half-life:** Must be at least 60 seconds
3. **Target deployment:** Required
4. **Credits:** Sponsor must have sufficient credits

## Events

| Event | When Emitted |
|-------|--------------|
| `sponsor.pressure_issued` | Pressure created |
| `sponsor.pressure_cancelled` | Pressure cancelled |
| `sponsor.pressure_decayed` | Magnitude decayed > 10% from original |
| `sponsor.pressure_expired` | Magnitude < 1% of original |

## Key Invariants

1. Sponsors cannot trigger agent actions directly
2. Pressure always decays (exponential formula)
3. Cancellation doesn't instantly remove effects
4. Credits are non-refundable

## See Also

- [BRAIDS.md](./BRAIDS.md) - How pressures compose into braids
