## Environments (dev / stage / prod)

### Goals
- **Dev**: fast iteration, safe defaults, no real user data.
- **Stage**: production-like config + migrations + smoke tests, gated promotion.
- **Prod**: locked-down networking, audited access, backup/restore, alerting, WAF/rate limits.

### Naming
- **Terraform**: `infra/terraform/environments/{dev,stage,prod}`
- **Service DBs**: one DB per service (identity/discourse/messaging/etc.)
- **Topics**: `events.<service>.v1` (see `docs/product/event-taxonomy.md`)

### Promotion contract
- **Schema changes**: migrate in dev → stage → prod; never hot-edit prod DB.
- **CI gates**: lint/typecheck/tests/build + contract smoke (dry) always.
- **Release artifacts**: versioned containers + signed mobile builds.

### Secrets
See `docs/runbooks/secrets.md`.


