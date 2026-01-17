# Phase 7-10 Smoke Tests

Copy-pastable curl commands for testing Phases 7-10. All flows work locally with ports 4017/4018/4019.

## Prerequisites

```bash
# Start services
make dev

# Run migrations
make migrate
```

## Flow 1: Create Sponsor, Purchase Credits, Create Agent via Foundry

```bash
# Generate IDs
export SPONSOR_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
echo "SPONSOR_ID: $SPONSOR_ID"

# Purchase credits for sponsor
curl -X POST http://localhost:4017/sponsor/$SPONSOR_ID/credits/purchase \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000}'

# Create agent via Foundry with sponsor assignment
export AGENT_ID=$(curl -s -X POST http://localhost:4017/foundry/agents \
  -H "Content-Type: application/json" \
  -d "{
    \"handle\": \"smoke-agent-1\",
    \"deployment_target\": \"ox-lab\",
    \"sponsor_id\": \"$SPONSOR_ID\",
    \"config\": {
      \"cognition_provider\": \"anthropic\",
      \"throttle_profile\": \"normal\",
      \"bias\": {\"cooperation\": 0.5},
      \"initial_capacity\": 100,
      \"max_capacity\": 100
    }
  }" | jq -r '.agent.id')
echo "AGENT_ID: $AGENT_ID"

# Verify agent created
curl http://localhost:4017/foundry/agents/$AGENT_ID | jq .

# Allocate credits to agent
curl -X POST http://localhost:4017/sponsor/$SPONSOR_ID/agents/$AGENT_ID/credits/allocate \
  -H "Content-Type: application/json" \
  -d '{"amount": 100}'

# Check agent credits
curl http://localhost:4017/agents/$AGENT_ID/credits | jq .
```

## Flow 2: Create Sponsor Policy (Capacity on Storm)

```bash
# Create policy: allocate +15 capacity when stormy
curl -X POST http://localhost:4017/sponsor/$SPONSOR_ID/policies \
  -H "Content-Type: application/json" \
  -d '{
    "policy_type": "capacity",
    "cadence_seconds": 60,
    "rules": [
      {
        "if": [
          {"field": "env.weather_state", "op": "eq", "value": "stormy"}
        ],
        "then": {
          "action": "allocate_delta",
          "params": {"delta": 15}
        }
      },
      {
        "if": [
          {"field": "agent.remaining_balance", "op": "lt", "value": 20}
        ],
        "then": {
          "action": "allocate_delta",
          "params": {"delta": 10}
        }
      }
    ]
  }' | jq .

# List sponsor policies
curl http://localhost:4017/sponsor/$SPONSOR_ID/policies | jq .
```

## Flow 3: Trigger Storm and Observe Policy Application

```bash
# Trigger storm regime via physics
curl -X POST http://localhost:4019/regime/storm \
  -H "Content-Type: application/json" \
  -d '{"deployment_target": "ox-lab"}'

# Wait for policy tick (60 seconds) or check ox-read for events
sleep 65

# Check policy runs (ops role required)
curl http://localhost:4017/admin/sponsors/$SPONSOR_ID/policy-runs \
  -H "X-Ops-Role: true" | jq .

# View policy applications via ox-read (analyst role)
curl http://localhost:4018/ox/sponsors/$SPONSOR_ID/policy-runs \
  -H "X-Observer-Role: analyst" | jq .

# Check for sweep artifacts
curl "http://localhost:4018/ox/artifacts?type=sweep" \
  -H "X-Observer-Role: analyst" | jq .
```

## Flow 4: Action Types (Valid and Invalid)

```bash
# Valid solo action
curl -X POST http://localhost:4017/agents/$AGENT_ID/attempt \
  -H "Content-Type: application/json" \
  -d '{"action_type": "signal", "payload": {"message": "test"}}' | jq .

# Valid multi-agent action (create second agent first)
export AGENT2_ID=$(curl -s -X POST http://localhost:4017/foundry/agents \
  -H "Content-Type: application/json" \
  -d "{
    \"handle\": \"smoke-agent-2\",
    \"deployment_target\": \"ox-lab\",
    \"sponsor_id\": \"$SPONSOR_ID\",
    \"config\": {\"cognition_provider\": \"none\"}
  }" | jq -r '.agent.id')

curl -X POST http://localhost:4017/agents/$AGENT_ID/attempt \
  -H "Content-Type: application/json" \
  -d "{
    \"action_type\": \"negotiate\",
    \"participants\": [\"$AGENT2_ID\"],
    \"payload\": {\"proposal\": \"cooperation\"}
  }" | jq .

# Invalid action type
curl -X POST http://localhost:4017/agents/$AGENT_ID/attempt \
  -H "Content-Type: application/json" \
  -d '{"action_type": "invalid_action", "payload": {}}' | jq .

# Check ox_live_events for accepted/rejected
curl http://localhost:4018/ox/live?limit=10 | jq '.events[] | {type, action_type, summary}'
```

## Flow 5: Agent Requests Credits, Sponsor Allocates

```bash
# Agent requests credits
curl -X POST http://localhost:4017/agents/$AGENT_ID/attempt \
  -H "Content-Type: application/json" \
  -d '{
    "action_type": "request_credits",
    "payload": {
      "requested_amount": 50,
      "rationale": "Need credits for complex negotiation"
    }
  }' | jq .

# View credit requests via ox-read (analyst role)
curl http://localhost:4018/ox/credit-requests \
  -H "X-Observer-Role: analyst" | jq .

# Sponsor sees request and allocates credits
curl -X POST http://localhost:4017/sponsor/$SPONSOR_ID/agents/$AGENT_ID/credits/allocate \
  -H "Content-Type: application/json" \
  -d '{"amount": 50}' | jq .

# Verify credit balance updated
curl http://localhost:4017/agents/$AGENT_ID/credits | jq .

# View credit timeline via ox-read (analyst role)
curl http://localhost:4018/ox/agents/$AGENT_ID/credits \
  -H "X-Observer-Role: analyst" | jq .
```

## Flow 6: Foundry Config Updates

```bash
# Update agent config
curl -X PUT http://localhost:4017/foundry/agents/$AGENT_ID/config \
  -H "Content-Type: application/json" \
  -d '{
    "cognition_provider": "openai",
    "bias": {"risk_tolerance": 0.7}
  }' | jq .

# Deploy to different target
curl -X POST http://localhost:4017/foundry/agents/$AGENT_ID/deploy \
  -H "Content-Type: application/json" \
  -d '{"deployment_target": "ox-staging"}' | jq .

# View config history via ox-read (analyst role)
curl http://localhost:4018/ox/agents/$AGENT_ID/config-history \
  -H "X-Observer-Role: analyst" | jq .
```

## Flow 7: World State Observation

```bash
# Get current world state
curl http://localhost:4018/ox/world-state | jq .

# Get world state history
curl http://localhost:4018/ox/world-state/history?limit=10 | jq .

# Get effects by bucket
curl "http://localhost:4018/ox/world-effects?hours=1" | jq .
```

## Verification Checklist

After running smoke tests, verify:

- [ ] Sponsor wallet shows correct balance
- [ ] Agent credits allocated correctly
- [ ] Policy created and visible
- [ ] Policy applications logged (after storm regime)
- [ ] Sweep artifacts created for applied policies
- [ ] Valid actions accepted, invalid rejected
- [ ] Credit requests visible via ox-read
- [ ] Config history shows all changes
- [ ] World state updated by physics

## Cleanup

```bash
# Remove test data (optional)
unset SPONSOR_ID AGENT_ID AGENT2_ID
```

## Troubleshooting

### "policy not found"
- Check sponsor_id matches policy owner

### "agent not sponsored by this sponsor"
- Agent must have sponsor_id set to the sponsor

### "sponsor_credit_insufficient"
- Purchase more credits or allocate less

### Policy not applying
- Wait for cadence (60+ seconds)
- Check weather_state matches policy conditions
- View policy runs for skip reasons
