# Observability + Incident Operations (Spec)

## Purpose
Enable GenMe to:
- detect issues **before** users report them
- diagnose quickly with traces/logs/metrics
- mitigate safely with controlled levers
- learn via postmortems and continuous improvement

This spec complements `docs/runbooks/incident-response.md`.

## Golden signals (RED/USE)
Per service and per critical route:
- **Rate**: requests/sec
- **Errors**: 4xx/5xx, timeouts, retries
- **Duration**: p50/p95/p99 latency

Infra:
- CPU/mem, DB connections, cache hit rate, queue lag

Mobile:
- crash-free sessions, ANR rate, startup time, API error rates

## Telemetry pillars
### Logs
- Structured JSON logs with:
  - `service`, `env`, `version`
  - `correlation_id`
  - `actor_id` (when safe)
  - `route`, `status`, `latency_ms`
- PII redaction (email/phone/token) before ingestion.

### Metrics
- Service metrics exported via OpenTelemetry or Prometheus
- Business/Safety metrics emitted via pipeline (not ad-hoc dashboards)

### Traces
- Distributed tracing across gateway + services
- Propagate `x-correlation-id` end-to-end
- Sampling strategy (head-based + tail sampling for errors)

### Crash reporting
- Mobile crash reporting (Sentry or equivalent)
- Backend exception capture with correlation IDs

## Alerting & SLOs
### SLO examples (initial)
- API availability: 99.9%
- p95 latency for feed: < 500ms
- push delivery success: > 98%
- media upload success: > 99%
- crash-free sessions: > 99.5%

### Alert design
- Alerts fire on **user-impact** (burn rate), not noise
- Severity levels:
  - SEV0: outage / safety-critical
  - SEV1: major degradation
  - SEV2: partial / localized

## “See errors before they happen”
### Proactive detection
- Anomaly detection on:
  - error rate spikes
  - latency regression
  - queue backlog growth
  - push failure spikes
  - media finalize failures
  - auth failures
- Forecast queue SLA breaches (moderation + support).

### Synthetic monitoring
- scheduled “canary” flows:
  - login
  - fetch home feed
  - create post (no media)
  - media upload plan + finalize (dev/stage)
  - push register/unregister

## Incident workflow
### Standard process
1) Detect (alert / agent / support reports)
2) Triage (scope + severity + owner)
3) Mitigate (feature flag rollback, throttles, friction)
4) Resolve (fix + deploy)
5) Verify (canaries + metrics)
6) Postmortem (timeline, root cause, action items)

### Operational levers (mitigations)
- Feature flags (kill switches)
- Rate limiting knobs (per endpoint)
- Safety frictions (reduce harm while debugging)
- Traffic shaping (throttle heavy endpoints)
- Rollback deployments

All mitigations must be auditable and reversible.

## Dashboards (minimum set)
- Gateway: R/E/D by route
- Identity: auth errors, session revokes, policy gating
- Discourse: feed latency, write errors, media errors
- Messaging: send failures, queue sizes
- Safety: report intake, backlog, friction volume
- Notifications: device token health, delivery results
- Purge/Gathering: state correctness, clock drift
- Mobile: crash-free sessions, API failures by screen

## Admin UI integration
Observability module in Admin Console provides:
- error inbox (grouped by fingerprint + severity)
- trace lookup by correlation id
- per-user impact lens (aggregated where possible)
- runbooks + “safe actions”

## Agent integration
Agents should:
- watch dashboards + anomalies
- attach evidence snapshots
- propose mitigations (L1) and execute reversible actions (L2)
- escalate to humans when confidence is low


