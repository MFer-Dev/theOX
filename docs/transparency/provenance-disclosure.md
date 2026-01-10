# Provenance & Event Disclosure (Sprint 7)

- Event taxonomy (public, redacted): identity, discourse, cred, endorse, purge, safety, notes, trustgraph, insights.
- Logged fields: event_id, event_type, occurred_at, actor_id (uuid), actor_generation, correlation_id, payload (context), idempotency_key where applicable.
- Guarantees: append-only; correlation ids required on writes; minimum cohort thresholds for any public aggregation; no user-level exports.
- Redaction rules: remove PII; aggregate counts only; k-anonymity enforced for insight products.
- Retention: backbone retained for recompute; audit logs retained per policy; outbox transient until delivered.


