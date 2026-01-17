# Foundry (Agent Builder) v1 (Phase 10)

The Foundry is the second product: APIs for creating, configuring, and deploying headless agents. Configuration is portable and environment-agnostic.

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Headless Agent** | Agent without a specific "head" (interface adapter) |
| **Portable Config** | Environment-agnostic configuration |
| **Deployment Target** | Where the agent operates |
| **Foundry Version** | Schema version for forward compatibility |

## Configuration Model

### Agent Config Fields

| Field | Type | Description |
|-------|------|-------------|
| `cognition_provider` | enum | `none`, `openai`, `anthropic`, `gemini` |
| `throttle_profile` | enum | `normal`, `conservative`, `aggressive`, `paused` |
| `bias` | object | Numeric sliders (-1 to 1) for soft preferences |

### Bias Sliders

Bias values influence but do not determine behavior:

```json
{
  "bias": {
    "cooperation": 0.6,
    "risk_tolerance": -0.3,
    "verbosity": 0.1
  }
}
```

All values must be between -1 and 1. These are **preferences**, not scripts.

## API Endpoints (Agents Service - 4017)

### Create Agent

```bash
POST /foundry/agents
{
  "handle": "agent-alpha",
  "deployment_target": "ox-lab",
  "sponsor_id": "sponsor-uuid",
  "config": {
    "cognition_provider": "anthropic",
    "throttle_profile": "normal",
    "bias": {
      "cooperation": 0.5
    },
    "initial_capacity": 100,
    "max_capacity": 100
  }
}
```

Response:
```json
{
  "agent": {
    "id": "agent-uuid",
    "handle": "agent-alpha",
    "status": "active",
    "deployment_target": "ox-lab",
    "sponsor_id": "sponsor-uuid",
    "cognition_provider": "anthropic",
    "throttle_profile": "normal"
  },
  "event": { "event_id": "..." }
}
```

### Get Agent (Full Config)

```bash
GET /foundry/agents/:id
```

Response:
```json
{
  "agent": {
    "id": "...",
    "handle": "agent-alpha",
    "status": "active",
    "deployment_target": "ox-lab",
    "sponsor_id": "..."
  },
  "config": {
    "cognition_provider": "anthropic",
    "throttle_profile": "normal",
    "bias": { "cooperation": 0.5 },
    "portable_config": { ... },
    "version": 1,
    "foundry_version": 1
  },
  "capacity": {
    "balance": 100,
    "max_balance": 100
  },
  "credits": {
    "balance": 0
  }
}
```

### Update Config

```bash
PUT /foundry/agents/:id/config
{
  "cognition_provider": "openai",
  "bias": {
    "cooperation": 0.7,
    "risk_tolerance": 0.2
  }
}
```

Each update:
- Increments config version
- Emits `agent.config_updated` event
- Does NOT mutate event history (append-only)

### Deploy Agent

```bash
POST /foundry/agents/:id/deploy
{
  "deployment_target": "production"
}
```

Deployment:
- Keeps same agent ID (identity preserved)
- Validates target environment availability
- Emits `agent.deployed` event

### List Agents

```bash
GET /foundry/agents?sponsor_id=...&status=active&limit=50
```

## Events

| Event Type | Description |
|------------|-------------|
| `agent.foundry_created` | Agent created via Foundry |
| `agent.config_updated` | Config changed |
| `agent.deployed` | Agent (re)deployed to target |

## OX Read Projections (4018)

### Config History (analyst+)

```bash
GET /ox/agents/:id/config-history?limit=50
```

Response:
```json
{
  "agent_id": "...",
  "history": [
    {
      "id": "...",
      "ts": "2026-01-17T...",
      "change_type": "created",
      "changes": { ... }
    },
    {
      "id": "...",
      "ts": "2026-01-17T...",
      "change_type": "updated",
      "changes": { "cognition_provider": "openai" }
    }
  ]
}
```

## Portable Config

The `portable_config` field stores a snapshot that can be exported/imported:

```json
{
  "cognition_provider": "anthropic",
  "throttle_profile": "normal",
  "bias": {
    "cooperation": 0.5
  }
}
```

This is environment-agnostic. A "head" (deployment adapter) interprets this config.

## Templates (Future)

The `foundry_templates` table supports reusable configurations:

```sql
CREATE TABLE foundry_templates (
  id uuid PRIMARY KEY,
  name text UNIQUE NOT NULL,
  description text,
  config_json jsonb NOT NULL,
  created_by uuid
);
```

Template API not implemented in v1.

## Idempotency

All Foundry endpoints support `X-Idempotency-Key`:

```bash
curl -X POST http://localhost:4017/foundry/agents \
  -H "X-Idempotency-Key: create-agent-123" \
  -d '{ ... }'
```

## Constraints

1. **Bias bounds**: All values must be between -1 and 1
2. **Valid enums**: Cognition provider and throttle profile must be valid
3. **Environment check**: Deployment fails if target unavailable
4. **Identity preservation**: Redeploy keeps same agent ID
5. **Append-only history**: Config updates do not mutate past events

## Example: Full Agent Lifecycle

```bash
# 1. Create agent via Foundry
AGENT=$(curl -s -X POST http://localhost:4017/foundry/agents \
  -d '{"handle": "trader-1", "config": {"cognition_provider": "anthropic"}}' \
  | jq -r '.agent.id')

# 2. View full config
curl http://localhost:4017/foundry/agents/$AGENT

# 3. Update config
curl -X PUT http://localhost:4017/foundry/agents/$AGENT/config \
  -d '{"bias": {"risk_tolerance": 0.8}}'

# 4. Deploy to production
curl -X POST http://localhost:4017/foundry/agents/$AGENT/deploy \
  -d '{"deployment_target": "production"}'

# 5. View config history (via ox-read)
curl http://localhost:4018/ox/agents/$AGENT/config-history \
  -H "X-Observer-Role: analyst"
```

## Headless Agent + Head Architecture

```
┌─────────────────────────────────────────────────┐
│                    Foundry                       │
│  (creates headless agent with portable config)   │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│              Headless Agent                      │
│  - ID, handle, status                            │
│  - portable_config (environment-agnostic)        │
│  - capacity, credits                             │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────┐
│              Head (Adapter)                      │
│  - Interprets portable_config                    │
│  - Bridges to specific environment               │
│  - Could be: CLI, API, webhook, etc.             │
└─────────────────────────────────────────────────┘
```

The "head" is not part of v1 - this is the conceptual architecture for future expansion.
