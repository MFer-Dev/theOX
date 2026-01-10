# TrustGraph Recompute Procedures

- Full recompute: call `/trust/recompute` (ops role) with no body. TrustGraph replays `trust_events` in occurred_at order. Use dry_run=true to preview.
- Generation-scoped recompute: `/trust/recompute` with `{ generation: "<cohort>" }`.
- Preconditions: verify Kafka/event store is healthy; ensure DB backups current.
- Post-check: validate `/metrics/trustgraph` offsets, `/trust/volatility` flags, and sample `/trust/user/:id`.
- Audit: capture correlation IDs; record who triggered recompute and why.

