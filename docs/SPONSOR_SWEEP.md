# Sponsor Sweep Policies (Phase 7)

Sponsors influence agents indirectly over time by adjusting constraints. This is the "curling sweep" layer - sponsors can smooth the path but cannot control where the stone goes.

## Core Principle

Sponsors **cannot**:
- Force agents to take actions
- Edit agent history
- Override environment constraints
- Bypass capacity limits

Sponsors **can**:
- Adjust capacity allocations on cadence
- Change cognition provider assignments
- Modify throttle profiles
- Trigger redeployments to allowed targets

## Policy Types

| Type | Action | Parameters |
|------|--------|------------|
| `capacity` | `allocate_delta` | `delta: number` (can be negative) |
| `cognition` | `set_provider` | `provider: none\|openai\|anthropic\|gemini` |
| `throttle` | `set_profile` | `profile: normal\|conservative\|aggressive\|paused` |
| `redeploy` | `redeploy` | `deployment_target: string` |

## Policy Rules Format

Policies use a simple rule engine with predicates:

```json
{
  "policy_type": "capacity",
  "cadence_seconds": 300,
  "rules": [
    {
      "if": [
        { "field": "env.weather_state", "op": "in", "value": ["stormy", "drought"] },
        { "field": "agent.remaining_balance", "op": "lt", "value": 20 }
      ],
      "then": {
        "action": "allocate_delta",
        "params": { "delta": 10 }
      }
    }
  ]
}
```

### Available Predicates

| Field | Description |
|-------|-------------|
| `agent.id` | Agent UUID |
| `agent.status` | Agent status enum |
| `agent.deployment_target` | Current deployment |
| `agent.cognition_provider` | Current provider |
| `agent.throttle_profile` | Current throttle profile |
| `agent.remaining_balance` | Current capacity balance |
| `agent.max_balance` | Max capacity |
| `env.cognition_availability` | `full\|degraded\|unavailable` |
| `env.throttle_factor` | Environment multiplier |
| `env.weather_state` | Current weather regime |

### Operators

| Operator | Description |
|----------|-------------|
| `eq` | Equal |
| `neq` | Not equal |
| `gt` | Greater than |
| `gte` | Greater than or equal |
| `lt` | Less than |
| `lte` | Less than or equal |
| `in` | Value in array |
| `not_in` | Value not in array |

## API Endpoints

### Agents Service (4017)

```bash
# Create policy
POST /sponsor/:sponsorId/policies
{
  "policy_type": "capacity",
  "rules": [...],
  "cadence_seconds": 300
}

# List policies
GET /sponsor/:sponsorId/policies?active=true

# Update policy
PUT /sponsor/:sponsorId/policies/:policyId
{
  "rules": [...],
  "cadence_seconds": 600
}

# Disable policy
POST /sponsor/:sponsorId/policies/:policyId/disable

# View policy runs (ops only)
GET /admin/sponsors/:sponsorId/policy-runs
```

### OX Read Service (4018)

```bash
# View sponsor policies (analyst+)
GET /ox/sponsors/:id/policies

# View policy applications (analyst+)
GET /ox/sponsors/:id/policy-runs?limit=50
```

## Events

| Event Type | Description |
|------------|-------------|
| `sponsor.policy_created` | New policy registered |
| `sponsor.policy_updated` | Policy rules/cadence changed |
| `sponsor.policy_disabled` | Policy deactivated |
| `agent.sponsor_policy_applied` | Policy successfully applied to agent |
| `agent.sponsor_policy_skipped` | Policy evaluated but not applied |

## Idempotency

Each policy tick generates a unique `source_tick_id`. Policy runs are idempotent per (policy_id, source_tick_id) pair. Replaying events will not re-apply policies.

## Artifacts

When a policy is applied, a "sweep" artifact is created:

```json
{
  "artifact_type": "sweep",
  "title": "Sponsor policy capacity applied",
  "metadata": {
    "policy_id": "...",
    "sponsor_id": "...",
    "policy_type": "capacity",
    "diff": {
      "previous_balance": 15,
      "new_balance": 25,
      "delta": 10
    }
  }
}
```

## Constraints

1. **Cadence minimum**: 60 seconds
2. **Delta bounds**: Cannot force balance below 0 or above max_balance
3. **Environment respect**: Redeploys fail if target environment is unavailable
4. **No action forcing**: Policies cannot trigger agent actions

## Example: Storm Response Policy

```bash
curl -X POST http://localhost:4017/sponsor/$SPONSOR_ID/policies \
  -H "Content-Type: application/json" \
  -d '{
    "policy_type": "capacity",
    "cadence_seconds": 120,
    "rules": [
      {
        "if": [
          { "field": "env.weather_state", "op": "eq", "value": "stormy" }
        ],
        "then": {
          "action": "allocate_delta",
          "params": { "delta": 15 }
        }
      },
      {
        "if": [
          { "field": "env.weather_state", "op": "eq", "value": "drought" }
        ],
        "then": {
          "action": "allocate_delta",
          "params": { "delta": -5 }
        }
      }
    ]
  }'
```

This policy allocates +15 capacity during storms (help agents survive) and -5 during drought (conserve resources).
