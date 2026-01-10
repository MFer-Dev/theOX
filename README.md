# GenMe Monorepo

GenMe is a **React Native social app** with a modular **Fastify + Postgres** backend, a **Next.js Ops/Admin console**, and an **event-driven “ops agents”** scaffold for automation (human-in-the-loop).

This repository is organized for fast iteration in one place (apps + services + platform libs + infra + docs). We can split repos later once boundaries harden.

## Structure
- `apps/`
  - `mobile/` — React Native + Tamagui app
  - `ops-console/` — Next.js admin/ops console UI
- `services/` — Fastify APIs (each with `/docs`, `/healthz`, `/readyz`)
  - Core: `gateway`, `identity`, `discourse`, `purge`, `cred`, `endorse`, `notes`, `trustgraph`, `safety`, `insights`, `notifications`, `search`, `lists`, `messaging`, `ai`
  - Ops: `ops-gateway` (admin API), `ops-agents` (agent task orchestrator)
- `workers/` — background consumers (Kafka/Redpanda) and batch jobs
- `platform/` — shared libs: `shared`, `events`, `security`, `observability`
- `infra/` — Terraform modules + environments (scaffolds)
- `docs/` — product specs, runbooks, QA, transparency artifacts

## What’s built right now (high-level)
### Mobile app (`apps/mobile`)
- Premium UI primitives + theming (light/dark + Gathering mode)
- Onboarding + legal acceptance flow
- Core screens (home/search/inbox/profile/thread/lists/settings/compose)
- Credibility surfacing (SCS badge) + generation ring + explainers
- Gathering dev tools + header lockup + countdown

### Core backend services (`services/*`)
- Identity/auth + sessions + policy acceptance + account deletion
- Discourse posts/replies + media pipeline scaffold + finalize hook
- Safety service with reports/flags/friction/restrictions/appeals + burst heuristics
- Notifications service with device registration + worker scaffold
- Search, lists, messaging, trustgraph, insights scaffolds

### Ops/Admin plane (new)
- `apps/ops-console`: real UI wired to backend services
- `services/ops-gateway` (port `4013`):
  - RBAC enforcement (dev header-based for now)
  - append-only ops audit log
  - user search + user “360” view (identity + sessions + safety + recent discourse)
  - moderation queue from safety `reports` + actions (v0)
  - observability health page (v0)
- `services/ops-agents` (port `4014`):
  - agent task DB + approvals
  - **event-driven ingestion** (consumes `events.*.v1` when enabled)
  - executes approved actions via **ops-gateway tool endpoints** (approval-gated)

## Local prerequisites
- Node 20+
- `pnpm` (workspace)
- Docker (for Postgres + Redpanda + Redis)

## Quickstart (backend)
```bash
pnpm install
pnpm core:up              # starts docker deps (if needed) + core services

# one-time: run per-service migrations you care about (identity, discourse, safety, etc.)
pnpm --filter @services/identity migrate
pnpm --filter @services/discourse migrate
pnpm --filter @services/safety migrate
pnpm --filter @services/ops-gateway migrate
pnpm --filter @services/ops-agents migrate
```

## Quickstart (ops console)
```bash
pnpm --filter @apps/ops-console dev
```

Ops console expects:
- `NEXT_PUBLIC_OPS_API_BASE_URL` (defaults to `http://localhost:4013`)
- `NEXT_PUBLIC_OPS_AGENTS_URL` (defaults to `http://localhost:4014`)

Dev auth is currently header/localStorage based (SSO/cookies comes next).

## Quickstart (mobile)
See `apps/mobile/README.md`.

## Ports (local defaults)
- `4000` gateway
- `4001` identity
- `4002` discourse
- `4003` purge
- `4004` cred
- `4005` endorse
- `4006` notes
- `4007` trustgraph
- `4008` safety
- `4009` notifications
- `4010` search
- `4011` messaging
- `4012` lists
- `4013` ops-gateway
- `4014` ops-agents
- `4015` insights
- `4016` ai

## Docs (what to read first)
- Backoffice/ops system specs: `docs/product/ops/README.md`
- Event backbone: `docs/product/event-taxonomy.md`
- Semantic/IP boundary: `docs/product/semantic-layer.md`
- Media pipeline contract: `docs/product/media-pipeline.md`
- Runbooks: `docs/runbooks/*`

## GitHub Desktop
If you’re trying to connect GitHub Desktop and this folder isn’t recognized as a repo yet, see:
- `docs/runbooks/github-desktop.md`

## Contributing / Security
- See `CONTRIBUTING.md`
- No secrets in git — use local env files; see `SECURITY.md`

