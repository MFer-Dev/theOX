# Admin / CRM Console (Spec)

## Purpose
The Admin Console is the **single operating surface** for running GenMe:
- Trust & Safety + moderation + appeals
- Customer support (CRM) + incident triage
- User/account lifecycle (sessions/devices/deletion/export)
- Operational controls (Gathering, feature flags, config)
- Observability “front door” (errors before they happen, and resolution when they do)
- Analytics + experiments (read-only for most roles)

## Product principles
- **Fast**: search-first, keyboard-friendly, low-latency views.
- **Safe**: all sensitive actions are gated (role + reason codes + optional approvals).
- **Audited**: every admin read/write is recorded with correlation IDs.
- **Composable**: pages are built from reusable “panels” (User panel, Content panel, Device panel, Risk panel).

## Personas
- **Support**: helps users, resolves account issues, views limited content.
- **Trust & Safety**: handles reports, removes content, applies restrictions/friction.
- **Moderator**: reviews queues; cannot change system config.
- **Ops**: handles incidents, feature flags, Gathering controls, service health.
- **Engineer**: debugging, tracing, migrations, tooling.
- **Compliance**: audit views, export logs, legal holds.

## Auth / RBAC
### Authentication
- SSO preferred (Okta/Google Workspace) for employees/contractors.
- Break-glass local admin for emergencies (hardware key requirement).

### Authorization model
- Role-based access control (RBAC) with **scopes**.
- Resource-level access policies for sensitive objects (e.g., legal holds).
- “Four-eyes” approval for irreversible actions (optional phase-gated).

### Baseline roles (initial)
- `support.read`, `support.write_limited`
- `safety.read`, `safety.moderate`
- `ops.read`, `ops.write_config`
- `engineering.read`, `engineering.write_tools`
- `compliance.read`, `compliance.export`
- `admin.super`

## Global UI architecture
### Global chrome
- Global search bar (users, handles, emails/phone hashed lookups, content IDs, device IDs, correlation IDs).
- Environment badge (dev/stage/prod) + deploy version.
- Alerts bell (incidents, queue SLA breaches, agent escalations).
- “Work” inbox (assigned tickets, review tasks, approvals).

### Primary nav (modules)
- **Dashboard**
- **Users**
- **Content**
- **Reports & Appeals**
- **Safety / Risk**
- **Messaging & Notifications**
- **Gathering (World Ops)**
- **Experiments & Feature Flags**
- **Analytics** (read-only for most roles)
- **Observability**
- **Agents** (agent task inbox + tools)
- **Audit / Compliance**
- **Settings**

## Core objects (admin-visible)
- `User`: identity, profile, status, restrictions, SCS, generation, deletion state
- `Session`: device fingerprint, last active, revocation state
- `Device`: push tokens, platform, risk signals
- `Content`: entries, replies, media, notes, moderation status
- `Report`: reporter, target, reason, status, evidence
- `Appeal`: target, message, status, resolution
- `ModerationAction`: actor, action, reason_code, timestamps
- `Friction`: target, type, expires_at, rationale, algo_version
- `Restriction`: user-level restriction with expiry (read-only for support)
- `Incident`: severity, owner, timeline, mitigations, postmortem
- `Experiment`: key, variants, targeting, metrics, guardrails
- `Flag`: boolean/enum config with rollout, kill-switch semantics
- `AgentTask`: proposed action bundle, evidence, approvals, execution result
- `AuditLog`: append-only admin access log

## Dashboard (exec + ops)
### “Business health”
- DAU/WAU/MAU, retention, engagement, posting rate
- Gathering participation + conversion impact (from semantic layer aggregates)

### “Safety health”
- Reports per 1k users, response time, reversal rate, appeal rate
- Top emerging abuse clusters (topic-level and cohort-level only where possible)

### “Reliability health”
- Crash-free sessions, p95 latency per service, error rate by endpoint
- Push delivery success rate, media upload failures

### “Ahead of issues” (predictive)
- Anomaly alerts: sudden spikes in 4xx/5xx, auth failures, rate limits, moderation backlog, spam bursts
- Forecasting panels: queue SLA projection (time-to-clear), capacity guidance

## Users module
### User search
- Search by: handle, user_id, email/phone (hashed lookup), session_id, device_id, correlation_id.
- Result list shows risk badges: restricted, under review, deletion pending, high report rate.

### User 360 (single page)
Panels:
- **Identity**: handle, display name, generation status, SCS, created_at, deleted_at, policy acceptance.
- **Status**: restrictions, frictions, active flags, recent reports, trust signals.
- **Sessions & devices**: session list, device fingerprints, push tokens (redacted), last active.
- **Content summary**: recent posts, replies, media.
- **Support timeline**: tickets, prior contacts, notes (internal).
- **Audit**: admin actions taken on user (filtered view).

### User actions (with guardrails)
Support-safe (no irreversible harm):
- Reset password (when provider exists)
- Revoke session(s)
- Unregister push token
- Trigger “account deletion info” send

Safety-only:
- Apply restriction (post/DM/endorse cooldown)
- Apply friction (weight reduction, reply cooldown)
- Block account (temporary/permanent)
- Force re-verification / lock account

Compliance:
- Export user data package (subject access request)
- Place legal hold (freeze deletion & retention expiry)

## Content module
### Content 360
For an entry/reply/media:
- Content body + metadata + author
- Ranking “why” explanations (if present) + exposure summary
- Reports/flags history + moderation status + notes
- Media moderation signals (hash, classifier outcomes)

### Actions
- Remove content (soft delete)
- Quarantine (hidden pending review)
- Restore content (if removed)
- Apply “visibility friction” (downrank + warning)
- Lock thread / slow mode
- Add internal note (evidence)

All actions require:
- reason_code (enum)
- free-text rationale
- correlation_id attached to resulting events

## Reports & Appeals module
### Intake
- Reports are created in-app and enter queues with metadata.
- De-duplication and bucketing by target_id.

### Queues
- `spam`, `harassment`, `impersonation`, `dangerous`, `misinfo`, `csam` (restricted)
- SLA timers and escalations

### Appeals
- User appeals appear in an Appeals queue.
- “Overturn” flows must restore content/status + emit resolution events.

## Safety / Risk module
### Risk signals (internal)
- Velocity: posting/reply/endorse spikes
- Device/IP correlation (non-public)
- Report rate per user, per content, per topic (aggregated)
- Prior enforcement outcomes

### Controls
- View friction list (active + expiring)
- Apply/expire friction (ops-gated)
- Restriction templates (policy-configured)

## Gathering (World Ops)
- Schedule windows, start/end immediately (dev-only in early phases)
- Monitor countdown state and client adoption
- Post-event “impact review” panel

## Experiments & Feature Flags
### Feature flags
- Typed flags with owner, description, target rollout, kill switch.
- Rollout strategies: % rollout, allowlist, cohort/generation targeting.

### Experiments
- Hypothesis, primary metrics, guardrails, exposure logic.
- “Stop experiment” controls with audit trail.

## Observability module (front door)
This is the human UI for `docs/product/ops/observability.md`:
- error inbox, traces, dashboards
- user-impact lens (which cohorts affected)
- “mitigation playbooks” (toggle flags, apply friction, throttle, rollback)

## Agents module (UI for orchestration layer)
This is the human UI for `docs/product/ops/agent-orchestration.md`:
- Task inbox (suggestions, escalations, scheduled jobs)
- Evidence panes + trace of tool calls
- Approval workflow
- Policy view: what the agent is allowed to do

## Audit / Compliance
- Immutable audit log of:
  - admin logins
  - reads of sensitive panels
  - writes (actions) and approvals
  - exports performed
- Tamper-evident storage (append-only + hashing)

## API requirements (backend)
Admin Console is a web app that talks to:
- **Admin Gateway** (`/admin/*`), separate from mobile gateway
- Service-to-admin adapters:
  - identity admin endpoints
  - discourse moderation endpoints
  - safety reports/appeals/friction endpoints
  - notifications ops endpoints
  - purge/world ops endpoints
  - insights/semantic endpoints (read-only, k-anon enforced)

All admin requests include:
- `x-correlation-id`
- `x-ops-user` (admin principal)
- `x-ops-role` (scope assertions)
- `x-ops-reason` (required for write actions)

## Metrics (admin)
- p95 time-to-first-action per queue
- reversal rate (overturn / total actions)
- incident MTTR, MTTD
- agent suggestion acceptance rate and error rate


