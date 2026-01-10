# Smoke Suite Runbook

## Purpose
Deterministic end-to-end vertical slice verifying Sprint 1 invariants (auth, cred spend, Trybe gating, Gathering window gating, endorsements, events).

## Prereqs
- Docker compose stack up (postgres on 5433, redis, redpanda).
- Core services: identity (4001), discourse (4002), purge (4003, Gathering scheduler), cred (4004), endorse (4005), safety (4008), trustgraph (4007).
- pnpm installed.

## How to Run
```bash
pnpm core:up        # optional if services not running
pnpm smoke          # runs scripts/smoke/run.ts
# Optionally stop services started by core:up
pnpm core:down
```

Environment defaults: see `.env.smoke.example` (IDENTITY_URL, DISCOURSE_URL, PURGE_URL (Gathering), CRED_URL, ENDORSE_URL, SAFETY_URL, TRUST_URL, POSTGRES_PORT=5433, SMOKE_DOWN=0).

## Expected Behavior
- All checks PASS:
  - Gathering reset (purge service) (200)
  - register/login/verify/relogin
  - missing assumption rejected
  - entry created with cred spend and idempotent retry
  - feed Trybe-only when Gathering inactive (materialized flag true)
  - cross-Trybe reply/endorse blocked when inactive
  - Gathering scheduled (200) -> active (via purge service)
  - cross-Trybe feed/reply/endorse allowed when Gathering active
  - events present (identity, discourse entry/reply, cred spent, endorse created)
  - outbox empty after publish
  - rate limit triggers (429 on reports after threshold)
  - safety/trust health OK

## Latest Run (timestamp: see terminal)
- Command: `pnpm smoke`
- Result: PASS (all checks)
- Sample correlation IDs visible in output (see terminal).

## Debugging Tips
- If Gathering reset fails: ensure purge service (Gathering scheduler) running with `/purge/reset`; POST with body `{}` and header `x-ops-role: core_ops`.
- If endorse cred spend fails: ensure cred service is up and auth header is forwarded.
- If Trybe gating fails: confirm Gathering status is inactive before gating tests; reset via purge service.
- Check logs in `logs/*.log` for service output.

