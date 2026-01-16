# Architecture Overview

## System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         Clients                                 │
├──────────────────┬──────────────────┬──────────────────────────┤
│   Mobile App     │   Ops Console    │   External APIs          │
│   (React Native) │   (Next.js)      │                          │
└────────┬─────────┴────────┬─────────┴──────────────────────────┘
         │                  │
         ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Gateway (:4000)                        │
│  - Rate limiting, session validation, request routing           │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  identity   │     │  discourse  │     │   safety    │
│   (:4001)   │     │   (:4002)   │     │   (:4008)   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  PostgreSQL │     │    Redis    │     │  Redpanda   │
│   (:5433)   │     │   (:6379)   │     │   (:9092)   │
└─────────────┘     └─────────────┘     └─────────────┘
```

## Services

### Core Services

| Service | Port | Purpose |
|---------|------|---------|
| **gateway** | 4000 | API gateway - routing, rate limiting, auth validation |
| **identity** | 4001 | User registration, authentication, sessions |
| **discourse** | 4002 | Posts, replies, content creation |
| **purge** | 4003 | Gathering/event mechanics |
| **cred** | 4004 | Credibility scoring |
| **endorse** | 4005 | Endorsements |
| **notes** | 4006 | Notes service |
| **trustgraph** | 4007 | Trust relationships |
| **safety** | 4008 | Moderation, reports, restrictions |
| **notifications** | 4009 | Push notifications |
| **search** | 4010 | Search functionality |
| **messaging** | 4011 | Direct messages |
| **lists** | 4012 | User lists |
| **insights** | 4015 | Analytics |
| **ai** | 4016 | AI service |

### Ops Services

| Service | Port | Purpose |
|---------|------|---------|
| **ops-gateway** | 4013 | Admin API - RBAC, audit logs, moderation queue |
| **ops-agents** | 4014 | Agent task orchestrator, approval workflows |

## Technology Stack

### Backend
- **Runtime**: Node.js 20+
- **Framework**: Fastify
- **Language**: TypeScript (strict mode)
- **Database**: PostgreSQL 16
- **Cache**: Redis 7
- **Message Queue**: Redpanda (Kafka-compatible)

### Frontend
- **Mobile**: React Native 0.74 + Tamagui
- **Web**: Next.js 14 + Tailwind CSS

### Infrastructure
- **Container**: Docker
- **Orchestration**: AWS ECS
- **IaC**: Terraform
- **CI/CD**: GitHub Actions

## Data Flow

### Authentication Flow
```
Client → Gateway → Identity Service → PostgreSQL
                                   ↓
                              Redis (session cache)
```

### Content Creation
```
Client → Gateway → Discourse → PostgreSQL
                            ↓
                       Redpanda (events)
                            ↓
                    Materializer (worker)
```

### Event System

Events flow through Redpanda topics:
- `events.identity.v1` - User events
- `events.discourse.v1` - Content events
- `events.safety.v1` - Moderation events
- `events.messaging.v1` - Message events

Workers consume events for:
- Materialized views
- Audit logs
- Async processing

## Monorepo Structure

```
theOX/
├── apps/               # Frontend applications
│   ├── mobile/         # React Native app
│   └── ops-console/    # Next.js admin
│
├── services/           # Backend microservices
│   └── <service>/
│       ├── src/
│       │   ├── index.ts    # Server entry
│       │   └── migrate.ts  # DB migrations
│       ├── package.json
│       └── tsconfig.json
│
├── platform/           # Shared libraries
│   ├── shared/         # Auth, DB pools, utils
│   ├── events/         # Event system
│   ├── observability/  # Logging, tracing
│   └── security/       # Security utilities
│
├── workers/            # Background processors
│   ├── materializer/   # Event consumer
│   └── integrity/      # Integrity checks
│
└── infra/              # Infrastructure
    ├── terraform/      # AWS infrastructure
    └── docker/         # Dockerfiles
```

## Key Patterns

### Service Communication
- HTTP for sync calls (via gateway or direct)
- Kafka for async events
- Correlation IDs for tracing

### Database
- Each service owns its tables
- Migrations in `src/migrate.ts`
- Connection pooling via `@platform/shared`

### Security
- JWT tokens (15min access, 30d refresh)
- Session validation at gateway
- Rate limiting (Redis-backed)
- RBAC for ops endpoints

### Observability
- Structured logging (Pino)
- OpenTelemetry tracing
- Health endpoints (`/healthz`, `/readyz`)
