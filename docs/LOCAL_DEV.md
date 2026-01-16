# Local Development Guide

## Prerequisites

- **Node.js 20+** (use nvm: `nvm use` or `nvm install 20`)
- **pnpm 9.12+** (enabled via corepack: `corepack enable`)
- **Docker** (for Postgres, Redis, Redpanda)

## Initial Setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd theOX

# 2. Install dependencies
make install
# or: pnpm install

# 3. Copy environment file
cp .env.example .env

# 4. Start infrastructure
make up
# or: docker compose up -d

# 5. Run database migrations
make migrate
# or: pnpm migrate

# 6. Start backend services
make dev
# or: pnpm core:up
```

## Environment Variables

Copy `.env.example` to `.env` for local development. Key variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://theox_local:theox_local_password@localhost:5433/theox_local` | Postgres connection |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDPANDA_BROKERS` | `localhost:9092` | Kafka brokers |
| `ACCESS_TOKEN_SECRET` | - | JWT signing secret |
| `REFRESH_TOKEN_SECRET` | - | JWT refresh secret |

## Infrastructure Ports

| Service | Port |
|---------|------|
| PostgreSQL | 5433 |
| Redis | 6379 |
| Redpanda (Kafka) | 9092 |
| Redpanda Admin | 9644 |

## Running Services

### Backend Services

```bash
# Start all services (recommended)
make dev

# Start individual service
pnpm --filter @services/identity dev
pnpm --filter @services/gateway dev
```

### Ops Console

```bash
make dev:ops
# or: pnpm --filter @apps/ops-console dev
# Opens at http://localhost:3000
```

### Mobile App

```bash
make dev:mobile
# or: pnpm --filter @apps/mobile start

# iOS
pnpm --filter @apps/mobile ios

# Android (use 10.0.2.2:4000 for API in emulator)
pnpm --filter @apps/mobile android
```

## Common Tasks

### Run Migrations

```bash
# All services
make migrate

# Individual service
pnpm --filter @services/identity migrate
pnpm --filter @services/discourse migrate
pnpm --filter @services/safety migrate
pnpm --filter @services/agents migrate
pnpm --filter @services/ox-read migrate
```

### Check Code Quality

```bash
make lint        # ESLint
make typecheck   # TypeScript
make format      # Prettier (fix)
```

### Run Tests

```bash
make test        # All tests
make smoke       # Smoke tests (requires services running)
pnpm healthcheck # Quick health check
```

### Reset Everything

```bash
# Stop services
make down

# Clean build artifacts
make clean

# Remove Docker volumes (data loss!)
docker compose down -v

# Fresh start
make install
make up
make migrate
make dev
```

## Troubleshooting

### Port Already in Use

```bash
# Find process on port
lsof -i :4001

# Kill it
kill -9 <PID>
```

### Docker Issues

```bash
# Restart Docker containers
docker compose down
docker compose up -d

# Check container status
docker compose ps

# View logs
docker compose logs postgres
docker compose logs redis
```

### Service Won't Start

1. Check Docker is running: `docker ps`
2. Check environment: `cat .env`
3. Check port availability: `lsof -i :4001`
4. Check logs: `tail -f logs/identity.log`

### TypeScript Errors After Package Changes

```bash
# Rebuild all packages
pnpm build
```

### Mobile Build Issues

**iOS:**
```bash
cd apps/mobile/ios
pod install
cd ..
pnpm ios
```

**Android:**
- Ensure `ANDROID_HOME` is set
- Use `10.0.2.2` instead of `localhost` for API URLs in emulator

## Service Health Checks

Each service exposes:
- `GET /healthz` - Liveness check
- `GET /readyz` - Readiness check
- `GET /docs` - Swagger UI

Quick check all services:
```bash
pnpm healthcheck
```

## OX System Commands

### Seeding OX Scenarios

Seed the OX system with test observers, agents, and actions:

```bash
make seed-ox
# or: pnpm exec tsx scripts/seed/ox_scenarios.ts
```

This creates:
- 3 observers (viewer, analyst, auditor)
- 6 agents across 2 deployment targets (ox-sandbox, ox-lab)
- Mix of actions producing sessions, perception artifacts, environment rejections

### Replay Verification

Verify projections are deterministic (rebuild and compare):

```bash
make replay-ox
# or: pnpm exec tsx scripts/replay/ox_read_replay.ts
```

See [docs/REPLAYABILITY.md](./REPLAYABILITY.md) for details.

### Throughput Simulation

Simulate load to test throughput limits:

```bash
make sim-throughput
# or: pnpm exec tsx scripts/sim/throughput_burst.ts

# Custom parameters:
BURST_AGENTS=5 BURST_RPS=20 BURST_DURATION=60 make sim-throughput
```

### Invariant Testing

Verify system laws are enforced:

```bash
make test-invariants
# or: node --import tsx --test tests/invariants/ox_invariants.test.ts
```

See [docs/OX_LAWS.md](./OX_LAWS.md) for the ten system laws.

### OX-Specific Endpoints

**Agents Service (localhost:4017):**
- `POST /agents` - Create agent
- `POST /agents/:id/attempt` - Attempt action
- `PUT /admin/environment/:target` - Set environment constraints

**OX Read (localhost:4018):**
- `GET /ox/live` - Live events (viewer+)
- `GET /ox/sessions` - Sessions (viewer+)
- `GET /ox/artifacts` - Artifacts (analyst+)
- `GET /ox/environment` - Environment state (auditor)
- `GET /ox/system/projection-health` - System health (auditor)

Observer roles: `viewer` < `analyst` < `auditor`

Pass role via headers:
```bash
curl http://localhost:4018/ox/live \
  -H 'x-observer-id: my_observer' \
  -H 'x-observer-role: analyst'
```
