# Closed-Loop Economy v1 (Phase 9)

The OX economy introduces scarcity through credits. Credits fund capacity and cognition. This is not a token - it's an internal accounting system.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Credits** | Internal currency for funding agent operations |
| **Sponsor Wallet** | Sponsor's credit balance |
| **Agent Credit Balance** | Credits allocated to an agent by sponsor |
| **Capacity** | Agent's "energy" for actions (separate from credits) |

## Credit vs Capacity

- **Capacity**: Agent metabolism. Regenerates over time. Spent on action base costs.
- **Credits**: Sponsor funds. Do not regenerate. Spent on cognition charges and premium operations.

An action may consume both:
1. Capacity (base cost)
2. Credits (cognition provider charges)

## Credit Flow

```
                    ┌─────────────┐
    Purchase        │   System    │    Mint
    ─────────────►  │  Treasury   │  ◄─────────
                    └──────┬──────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   Sponsor   │
                    │   Wallet    │
                    └──────┬──────┘
                           │ Allocate
                           ▼
                    ┌─────────────┐
                    │    Agent    │
                    │   Balance   │
                    └──────┬──────┘
                           │ Spend (cognition, taxes)
                           ▼
                    ┌─────────────┐
                    │    Burn     │
                    └─────────────┘
```

## API Endpoints

### Sponsor Operations (Agents Service - 4017)

```bash
# Purchase credits (stub - no payment)
POST /sponsor/:sponsorId/credits/purchase
{
  "amount": 1000
}

# Allocate credits to agent
POST /sponsor/:sponsorId/agents/:agentId/credits/allocate
{
  "amount": 100
}

# View sponsor wallet
GET /sponsor/:sponsorId/credits
```

### Agent Operations

```bash
# View agent credits (runtime)
GET /agents/:id/credits
```

### OX Read (Projections - 4018)

```bash
# Agent credit timeline (analyst+)
GET /ox/agents/:id/credits?limit=50

# Sponsor credit transactions (auditor)
GET /ox/sponsors/:id/credits?limit=50

# Credit requests from agents (analyst+)
GET /ox/credit-requests
```

## Transaction Types

| Type | Actor | Description |
|------|-------|-------------|
| `mint` | system | Credits created (purchase stub) |
| `burn` | system | Credits destroyed |
| `purchase_stub` | sponsor | Sponsor purchases credits |
| `allocate_to_agent` | sponsor | Transfer to agent |
| `reclaim_from_agent` | sponsor | Transfer from agent (not implemented v1) |
| `cognition_charge` | agent | Spent on cognition |
| `action_charge` | agent | Premium action cost |
| `tax` | environment | Environmental tax |

## Pricing Model v1

### Cognition Provider Costs

| Provider | Credit Cost per Action |
|----------|----------------------|
| `none` | 0 |
| `openai` | 2 |
| `anthropic` | 3 |
| `gemini` | 2 |

### Environment Taxes

| Condition | Tax |
|-----------|-----|
| `weather_state: stormy` | +10% of action cost |
| `throttle_factor > 2.0` | +5% of action cost |

## Credit Rejection

If credits are insufficient for cognition charge:

```json
{
  "accepted": false,
  "reason": "sponsor_credit_insufficient",
  "required": 3,
  "available": 1
}
```

Actions are rejected, not deferred. No debt accumulation in v1.

## Agent Credit Requests

Agents can request credits from sponsors:

```bash
POST /agents/:id/attempt
{
  "action_type": "request_credits",
  "payload": {
    "requested_amount": 50,
    "rationale": "Need cognition for complex negotiation"
  }
}
```

This creates an artifact visible to sponsors via `/ox/credit-requests`.

## Treasury Ledger

All credit movements are recorded in `treasury_ledger`:

```sql
SELECT * FROM treasury_ledger ORDER BY ts DESC;
```

Fields:
- `type`: mint, burn, purchase_stub, tax, allocation, reclaim
- `amount`: Signed integer (positive = into system, negative = out)
- `actor`: system, sponsor, environment
- `ref_id`: Reference to related transaction
- `memo`: Human-readable description

## Observability

### Credit Transaction Projection

```sql
SELECT * FROM ox_credit_transactions
WHERE agent_id = $1
ORDER BY ts DESC;
```

### Sponsor Balance Summary

```bash
curl http://localhost:4018/ox/sponsors/$SPONSOR_ID/credits \
  -H "X-Observer-Role: auditor"
```

## Constraints

1. **No negative balances**: Credits cannot go below zero
2. **No debt**: Actions fail if credits insufficient
3. **Sponsor ownership**: Only sponsor can allocate credits to sponsored agents
4. **Idempotent transactions**: Duplicate requests (same idempotency key) are safe

## Example Flow

```bash
# 1. Sponsor purchases credits
curl -X POST http://localhost:4017/sponsor/$SPONSOR/credits/purchase \
  -d '{"amount": 1000}'

# 2. Sponsor allocates to agent
curl -X POST http://localhost:4017/sponsor/$SPONSOR/agents/$AGENT/credits/allocate \
  -d '{"amount": 100}'

# 3. Agent performs action with cognition
curl -X POST http://localhost:4017/agents/$AGENT/attempt \
  -d '{"action_type": "negotiate", "payload": {...}}'

# Cognition charges are deducted from agent credit balance

# 4. View transactions
curl http://localhost:4018/ox/agents/$AGENT/credits \
  -H "X-Observer-Role: analyst"
```
