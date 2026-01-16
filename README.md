# theOX Monorepo

A pnpm workspaces + Turbo monorepo containing:
- **Mobile app** (React Native + Tamagui)
- **Ops console** (Next.js admin UI)
- **Backend services** (17 Fastify microservices)
- **Platform libraries** (shared code)
- **Infrastructure** (Terraform + Docker)

## Quick Start

```bash
# Prerequisites: Node 20+, pnpm, Docker

# 1. Install dependencies
make install

# 2. Start infrastructure (Postgres, Redis, Redpanda)
make up

# 3. Run migrations
make migrate

# 4. Start all backend services
make dev

# 5. In another terminal, start ops console
make dev:ops
```

See [docs/LOCAL_DEV.md](docs/LOCAL_DEV.md) for detailed setup.

## Project Structure

```
theOX/
├── apps/
│   ├── mobile/           # React Native + Tamagui app
│   └── ops-console/      # Next.js admin/ops console
├── services/             # Fastify microservices
│   ├── gateway/          # API gateway (port 4000)
│   ├── identity/         # Auth/users (port 4001)
│   ├── discourse/        # Posts/replies (port 4002)
│   ├── safety/           # Moderation (port 4008)
│   ├── ops-gateway/      # Admin API (port 4013)
│   ├── ops-agents/       # Agent orchestrator (port 4014)
│   └── ...               # And 11 more services
├── workers/              # Background workers (Kafka consumers)
├── platform/             # Shared libraries
│   ├── shared/           # Auth, DB, rate limiting
│   ├── events/           # Event system, Kafka
│   ├── observability/    # Logging, tracing
│   └── security/         # Security utilities
├── infra/                # Terraform + Docker
├── docs/                 # Documentation
└── scripts/              # Dev/ops scripts
```

## Available Commands

### Using Make (recommended)

| Command | Description |
|---------|-------------|
| `make install` | Install all dependencies |
| `make up` | Start local infrastructure |
| `make down` | Stop local infrastructure |
| `make dev` | Start all backend services |
| `make dev:ops` | Start ops console (port 3000) |
| `make dev:mobile` | Start mobile Metro bundler |
| `make lint` | Run ESLint |
| `make typecheck` | Run TypeScript checks |
| `make format` | Format code with Prettier |
| `make test` | Run all tests |
| `make smoke` | Run smoke tests |
| `make migrate` | Run all migrations |
| `make clean` | Remove build artifacts |

### Using pnpm directly

```bash
pnpm install              # Install dependencies
pnpm dev:up               # Start Docker infrastructure
pnpm core:up              # Start all services
pnpm lint                 # Lint
pnpm typecheck            # Type check
pnpm build                # Build all packages
pnpm smoke                # Run smoke tests
pnpm healthcheck          # Check service health
```

## Service Ports

| Port | Service | Description |
|------|---------|-------------|
| 4000 | gateway | API gateway |
| 4001 | identity | Auth & users |
| 4002 | discourse | Posts & replies |
| 4003 | purge | Gathering mechanics |
| 4004 | cred | Credibility scoring |
| 4005 | endorse | Endorsements |
| 4006 | notes | Notes service |
| 4007 | trustgraph | Trust relationships |
| 4008 | safety | Moderation & reports |
| 4009 | notifications | Push notifications |
| 4010 | search | Search |
| 4011 | messaging | Direct messages |
| 4012 | lists | User lists |
| 4013 | ops-gateway | Admin API |
| 4014 | ops-agents | Agent orchestrator |
| 4015 | insights | Analytics |
| 4016 | ai | AI service |

## Documentation

- [Local Development](docs/LOCAL_DEV.md) - Setup and troubleshooting
- [Architecture](docs/ARCHITECTURE.md) - System overview
- [Contributing](CONTRIBUTING.md) - How to contribute
- [Security](SECURITY.md) - Security policy

## Tech Stack

- **Runtime**: Node.js 20+
- **Package Manager**: pnpm 9.12+
- **Build**: Turbo
- **Backend**: Fastify, TypeScript
- **Database**: PostgreSQL 16
- **Cache**: Redis 7
- **Queue**: Redpanda (Kafka-compatible)
- **Mobile**: React Native 0.74, Tamagui
- **Web**: Next.js 14, Tailwind CSS
- **Infra**: Terraform, Docker, AWS

## License

See [LICENSE](LICENSE)
