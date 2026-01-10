# Ops Console (Next.js)

This is the GenMe admin/ops UI.

## What it is
- UI: `apps/ops-console` (Next.js)
- Admin API: `services/ops-gateway` (default `http://localhost:4013`)
- Agents API: `services/ops-agents` (default `http://localhost:4014`)

## Run
```bash
pnpm --filter @apps/ops-console dev
```

## Environment
Set in your shell or `.env.local`:
- `NEXT_PUBLIC_OPS_API_BASE_URL` (default: `http://localhost:4013`)
- `NEXT_PUBLIC_OPS_AGENTS_URL` (default: `http://localhost:4014`)

## Dev auth (temporary)
Ops Console uses **cookie sessions** issued by `services/ops-gateway`.

Local seed credentials (created by `@services/ops-gateway migrate`):
- email: `admin@example.com`
- password: `admin`

You can override with:
- `OPS_SEED_EMAIL`
- `OPS_SEED_PASSWORD`
- `OPS_SEED_ROLE`

## Available modules (current)
- Users: search + User 360 (read-only)
- Moderation: queue from Safety reports + v0 actions
- Audit: ops audit log viewer
- Observability: readyz health fanout + local error inbox (fed by gateway proxy)
- Agents: task inbox + create/approve (execution goes through ops-gateway tools)


