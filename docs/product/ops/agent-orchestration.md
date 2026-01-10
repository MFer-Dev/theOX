# AI Agent Orchestration Layer (Spec)

## Purpose
Build an “Ops Autopilot” that:
- Detects issues early (reliability, safety, growth, support)
- Proposes actions with evidence (human-in-the-loop)
- Executes approved actions safely
- Learns via evals and postmortems

This is the leapfrog layer: **Instagram/Twitter-grade ops + agentic automation**.

## Core design
### The agent does not “be an admin”
The agent is a **task runner** operating through **explicit tools** and **policy gates**, never raw DB access.

### Safety model (graduated autonomy)
Autonomy levels per action type:
- **L0**: Observe-only (read tools, write nothing)
- **L1**: Suggest-only (draft actions, human approves)
- **L2**: Execute reversible actions automatically (rate limit, friction, feature flag rollback)
- **L3**: Execute irreversible actions with approval (content removals, bans)
- **L4**: Fully autonomous irreversible actions (future; requires maturity, audits, evals)

Default for GenMe: **L1/L2 only**.

## Architecture
### Services/components
- **Agent Orchestrator service**
  - schedules tasks, assigns to runners, enforces policy
  - stores task state machine
  - emits agent events to `events.ops_agents.v1`
- **Agent Runner**
  - executes model calls + tool calls
  - streaming traces
  - sandboxed execution (no network by default except tool endpoints)
- **Tool Gateway**
  - typed tool registry
  - authz + rate limits + redaction
  - write actions require `reason_code` + `approval_id` where applicable
- **Policy Engine**
  - who/what can execute which actions under which conditions
  - environment-aware (dev vs prod)
- **Evidence Store**
  - immutable snapshots used to justify decisions (trace IDs, dashboards, examples)
- **Audit Log**
  - append-only (task created → evidence → approvals → tool calls → results)
- **Admin UI (Agents module)**
  - task inbox, approvals, traces, playbooks, policy viewer

### Eventing
All agent actions are events:
- `ops.agent_task.created`
- `ops.agent_task.evidence_attached`
- `ops.agent_task.proposed_action`
- `ops.agent_task.approved`
- `ops.agent_task.executed`
- `ops.agent_task.failed`

## Agent task model
### Task types (examples)
- **Reliability triage**: “5xx spike in discourse; propose rollback + throttle”
- **Safety triage**: “reply burst suggests dogpile; propose friction on entry”
- **Support assist**: “user can’t login; suggest session revoke + reset link”
- **Growth ops**: “Gathering window underperforming; propose notification campaign”
- **Data pipeline**: “warehouse lag; propose restart consumer + backfill”

### Task state machine
`queued → running → needs_approval → executing → completed`
with failure states:
`failed_retryable`, `failed_terminal`, `escalated_to_human`

## Tooling model
### Tool categories
- **Read tools** (safe)
  - `get_user_360(user_id)`
  - `get_content_360(content_id)`
  - `get_queue_state(queue)`
  - `get_dashboard_snapshot(dashboard_id)`
  - `search_audit_logs(query)`
  - `trace_lookup(correlation_id)`
- **Write tools (reversible)** (candidate for L2)
  - `apply_friction(target, friction_type, expires_at, reason_code)`
  - `toggle_feature_flag(flag_key, value, rollout)`
  - `throttle_endpoint(service, route, limit)`
  - `revoke_push_tokens(user_id)`
- **Write tools (irreversible)** (L1 only initially)
  - `remove_content(content_id, reason_code)`
  - `ban_user(user_id, duration, reason_code)`
  - `resolve_appeal(appeal_id, resolution)`

### Tool contract requirements
Every tool call must log:
- inputs (redacted)
- outputs (redacted)
- correlation id
- policy decision and rule matched
- human approval reference (if required)

## Governance
### Prompt/model registry
- versioned agent definitions (system prompt, tool schema, policy)
- change control: review + staged rollout

### Continuous evaluation
- replay historical incidents (offline) against new agent versions
- measure:
  - correctness of proposed actions
  - false positive/negative rates
  - time-to-mitigation
  - safety violations (should be zero)

### Drift + anomaly monitoring
- detect behavior changes in models/tools
- auto-downgrade autonomy level if anomalies occur

## Human-in-the-loop (HITL) UX
### Approval queue
Each proposal includes:
- summary
- risk score
- blast radius estimate
- evidence links (dashboards, traces, samples)
- rollback plan

Approvers can:
- approve as-is
- edit parameters (within policy bounds)
- reject with feedback (feeds eval set)

## Security & privacy
- No raw PII in prompts by default
- Redaction at Tool Gateway (email/phone/address)
- Per-tenant/environment isolation
- Secrets never accessible to runners

## Admin UI integration
The Agents module provides:
- **Task inbox** (filters: incident, safety, support, growth)
- **Task detail** with tool trace timeline
- **Evidence viewer**
- **Approval panel**
- **Policy viewer + audit**

## Implementation phases
### Phase A (now)
- orchestrator + tool gateway skeleton
- L0/L1 only
- integrate with: safety, identity sessions, feature flags, dashboards

### Phase B
- add reversible auto-actions (L2) with strict guardrails
- add eval harness + replay

### Phase C
- deep integrations (support CRM, experimentation, semantic insights)


