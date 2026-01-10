# Release Engineering + Infra + SRE Ops (Spec)

## Purpose
Provide a production-grade operating system for shipping GenMe:
- secure environments (dev/stage/prod)
- repeatable deploys + rollbacks
- migrations + data safety
- secrets management + access control
- backups/PITR + restore drills

This spec complements:
- `docs/runbooks/environments.md`
- `docs/runbooks/secrets.md`
- `docs/runbooks/backups.md`

## Environments
### Dev
- local + shared dev deployment
- feature flags enabled
- synthetic data allowed

### Stage
- production-like configs
- required for release candidate validation
- runs smoke suites and canaries

### Prod
- locked down (private networking, WAF, strict IAM)
- on-call and incident response required
- change management for critical systems

## CI/CD
### Pipeline stages
- lint/typecheck/tests/build (already in CI)
- package service artifacts (containers)
- deploy to dev on merge
- deploy to stage on release branch/tag
- deploy to prod after approvals

### Release artifacts
- versioned containers for services
- signed mobile builds
- immutable release notes + changelog

## Migrations strategy
### Rules
- forward-only migrations
- migrations run as a dedicated job (not in app startup)
- stage must run migrations before prod

### Rollback
- app rollback supported at any time
- schema rollback is exceptional; prefer expand/contract patterns

## Infrastructure baseline (AWS target)
### Core components
- VPC + private subnets
- RDS Postgres (per service DB or shared cluster with schemas)
- Redis (rate limit + caching)
- Kafka/Redpanda/MSK (events backbone)
- Object storage + CDN (media)
- Compute (ECS/EKS) + load balancer + WAF

### IaC
- Terraform modules per component
- separate state per environment

## Secrets & access control
- Secrets Manager / SSM Parameter Store
- IAM roles for services
- no long-lived AWS keys in prod
- break-glass workflow (audited)

## Backups/PITR + restore drills
### Expectations
- nightly snapshots + PITR for DB
- quarterly restore drills
- documented RPO/RTO

### Automation
- scripted restore drill (see `scripts/ops/restore-drill.sh`)
- smoke test suite validates restored env

## Operational playbooks
### SRE runbooks
- deploy/rollback
- incident response
- scaling
- backfill/recompute for event consumers
- trustgraph recompute (already has a runbook)

## Agent integration
Agents can assist with:
- detecting regressions post-deploy
- generating rollback proposals
- executing reversible mitigations (flags/throttles) under policy


