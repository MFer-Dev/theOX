# GenMe Backoffice / Ops System (Spec Index)

This folder specifies the **business-operating backend** required to run GenMe at Instagram/Twitter scale, plus an **AI agent orchestration layer** designed to leapfrog current industry capabilities.

It is written as:
- **Best-in-class current-state** (what mature companies run today)
- **Leapfrog layer** (agentic ops with human-in-the-loop + governance)

## Non-negotiable guardrails
- **Least privilege**: role-based access, approvals for irreversible actions, full audit trail.
- **Privacy by design**: PII minimization, redaction, retention windows, deletion propagation.
- **Safety**: no fully-autonomous irreversible enforcement at first; graduated autonomy via policy.
- **Explainability**: user-impacting systems have “why” traces (ranking, moderation, enforcement, experiments).

## Specs (start here)
- **Admin / CRM Console**: [`admin-console.md`](./admin-console.md)
- **AI agent orchestration layer**: [`agent-orchestration.md`](./agent-orchestration.md)
- **Moderation + Trust & Safety**: [`moderation-trust-safety.md`](./moderation-trust-safety.md)
- **Observability + Incident Ops**: [`observability.md`](./observability.md)
- **Analytics + Semantic layer**: [`analytics.md`](./analytics.md)
- **Privacy + Data governance**: [`privacy-data-governance.md`](./privacy-data-governance.md)
- **Release + Infra + SRE operations**: [`release-ops-infra.md`](./release-ops-infra.md)

## Existing repo docs this builds on (do not duplicate)
- **Event backbone**: `docs/product/event-taxonomy.md`
- **Semantic layer boundary**: `docs/product/semantic-layer.md`
- **Semantic IP products**: `docs/product/ip-products.md`
- **Media pipeline contract**: `docs/product/media-pipeline.md`
- **Gathering mechanics**: `docs/product/gathering-mechanics.md`
- **Safety ops basics**: `docs/runbooks/safety-playbook.md`
- **Incident template**: `docs/runbooks/incident-response.md`

## Implementation roadmap (high-level)
### Phase 0 — minimum viable ops (pre-Store / early alpha)
- Basic Admin auth/RBAC + audit logging
- User lookup + session/device management
- Report intake + manual moderation actions
- Crash reporting + service dashboards + alerting
- Event schema validation at publish time

### Phase 1 — scale readiness (beta)
- Full queue-based moderation + appeals
- Abuse automation + friction engine, review tooling, metrics
- On-call runbooks + incident workflow, deploy pipelines, canaries
- Analytics warehouse + KPI layer + experiment platform

### Phase 2 — leapfrog (agentic ops)
- Agent-run triage + suggested actions across domains
- HITL approvals → action execution → verification
- Continuous evals + drift monitoring + policy gates
- “Ops autopilot” for reversible actions (rate limits, friction, config toggles)


