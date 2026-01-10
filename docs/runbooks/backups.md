# Backups & Restore (runbook)

This repo uses Postgres as the source of truth per service DB.

## Scope
- Back up **each service database** (identity, discourse, purge, etc.)
- Back up **Redis** only if you rely on persistent rate-limit counters (optional; safe to lose)
- Event log (Kafka/Redpanda) is recomputable from DB outboxes, but you should still snapshot in production.

## Local (docker-compose)
Postgres runs on `${POSTGRES_PORT:-5433}`.

### Backup
```bash
pg_dump -h localhost -p 5433 -U genme_local -Fc -f backup.dump genme_local
```

### Restore
```bash
pg_restore -h localhost -p 5433 -U genme_local -d genme_local --clean backup.dump
```

## Production expectations
- Nightly automated snapshots + point-in-time recovery
- Quarterly restore drills
- Document RPO/RTO and who is on-call


