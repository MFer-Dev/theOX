# Data Retention & Audit Readiness

- Event backbone: retained indefinitely for recompute and audit; redacted exports available.
- Audit logs (safety, notes, moderation): retained; tamper-resistant posture; access is role-gated.
- Outbox records: transient until delivered; failures logged.
- DB backups: follow infra policy (documented in infra/); verify restore before releases.
- Role separation: ops vs dev privileges kept distinct; ops endpoints require x-ops-role; dev has no silent overrides.
- Requests to delete personal data: handled via GRC (see DSAR runbook); core events may be pseudonymized but not erased if required for audit.
- Data subject exports: provide JSON with user-owned data, excluding other users’ data; log requests and fulfillment.
- Retention enforcement: scheduled checks to ensure tables respect policy; document retention windows per table/service.
- k-anonymity for insights: enforce minimum cohort sizes; no user-level exports; no raw content in insight products.

