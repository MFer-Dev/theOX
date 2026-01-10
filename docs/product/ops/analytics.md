# Analytics + Semantic Layer + Experimentation (Spec)

## Purpose
Provide a stable, governed analytics system that supports:
- product decision-making (KPIs, funnels, retention)
- trust & safety insights (aggregate abuse trends)
- ranking explainability (“why you saw this” telemetry)
- covenant-safe semantic/IP products (derived-only)

This spec builds on:
- `docs/product/event-taxonomy.md`
- `docs/product/semantic-layer.md`
- `docs/product/ip-products.md`

## Event instrumentation (canonical)
### Requirements
- All services emit versioned events to `events.<domain>.v1`
- Enforce envelope schema at publish-time (reject invalid)
- Version payloads by:
  - adding fields as optional first
  - never renaming shipped fields
  - creating new event types for semantic changes

### Client events
Mobile emits client analytics events (separate topic):
- `events.client_mobile.v1`
with strict PII policies (no raw message content, no contact info).

## Data pipeline
### Ingestion
- Consume event topics into a warehouse (Snowflake/BigQuery/ClickHouse)
- Store raw immutable events + derived tables
- Late-arrival handling and idempotency (event_id primary key)

### Modeling layers
1) **Raw**: append-only events
2) **Normalized**: domain tables (users, sessions, content, interactions)
3) **Metrics**: KPI tables + definitions
4) **Semantic/derived**: topic/cohort aggregates (k-anon enforced)

## Metrics layer (single source of truth)
### KPI registry
Define metrics in code/config:
- name, owner, description
- numerator/denominator definitions
- dimensions allowed
- privacy classification

### Guardrails
- K-anonymity thresholds for segmented outputs
- Suppression for small cohorts
- Redaction for sensitive dimensions

## Experimentation platform
### Requirements
- Assignment service (sticky bucketing)
- Exposure logging events
- Pre-registered metrics (avoid p-hacking)
- Guardrail alerts (crash rate, latency, abuse)

### Experiment lifecycle
draft → review → launch → monitor → stop/ship → archive

## Ranking explainability telemetry
### “Why you saw this” contract
User-facing:
- small stable list of `why` codes per ranked item

Internal analytics:
- exposure logs per surface:
  - `feed.item_exposed` { surface, item_id, rank, why_codes, algo_version }
  - `feed.item_clicked`
  - `feed.item_hidden` / “not interested”

### Governance
- why codes are a **user-facing API**: version carefully.

## Semantic layer (derived-only)
### Boundary (from semantic-layer.md)
- never export user-level data externally
- only aggregates with k-anon
- recomputable from events

### Internal insights APIs
- `/insights/*` endpoints implemented by trustgraph/semantic service
- audit access, enforce API keys + quotas

## Admin Console integration
Analytics module in Admin Console provides:
- KPI dashboards (read-only)
- experiment overview and guardrails
- semantic insights (k-anon enforced)
- incident correlation (metrics + traces + safety signals)

## Agent integration
Agents should:
- monitor KPI guardrails and anomalies
- generate hypotheses and propose experiments (human-approved)
- propose mitigations on metric regressions (flags/rollbacks)


