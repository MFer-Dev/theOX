# Moderation + Trust & Safety (Spec)

## Purpose
Run GenMe safely at scale with:
- clear policy enforcement workflows
- automation + human review
- transparency + appeals
- auditability + compliance posture

This spec extends the existing runbook `docs/runbooks/safety-playbook.md` into a full operating system.

## Core concepts
### Objects
- **Report**: user-submitted complaint about a target (content/user/message/media).
- **Flag**: system/agent-generated alert requiring review.
- **Friction**: temporary limitation or downweighting (reversible, expires).
- **Restriction**: user-level limitation (may be reversible; stronger than friction).
- **ModerationAction**: human/ops action taken (remove/restore/ban/etc).
- **Appeal**: user challenge to a friction/restriction/action.
- **Evidence**: immutable snapshots supporting a decision (content, metadata, logs).

### Enforcement ladder (graduated)
1) Informational: labels, warnings, “read more”
2) Friction: slow-mode, reply cooldown, endorse weight reduction
3) Restrictions: posting/DM limits, feature locks, temporary suspensions
4) Removal: content takedown (soft delete)
5) Account actions: temporary/permanent bans, device-level blocks (careful)

## Policy engine
### Policy sources
- Legal/policy docs (ToS, Community Guidelines)
- Safety playbooks (internal)
- Risk scoring and detection heuristics

### Policy requirements
- Every action requires a **reason_code** (enum) + free-text rationale.
- Policy version must be recorded on action.
- Reversal must also be logged (with separate reason_code).

## Queues & SLAs
### Queues (initial)
- Spam/automation
- Harassment/hate
- Impersonation
- Self-harm / dangerous
- Illegal content (restricted access)
- CSAM (highly restricted, special handling)
- Appeals

### SLA targets (initial)
- High severity: first action < 30 minutes
- Standard: first action < 24 hours
- Appeals: decision < 7 days

## Detection + automation
### Signal sources
- Event stream: bursts, velocity, repeated rejects, coordinated actions
- Content signals: similarity, link frequency, suspicious media hashes
- Network/device: fingerprint reuse, IP churn (internal only)
- Reputation: SCS class + historical enforcement
- User reports and reporter trust score (derived internally)

### Automated mitigations (safe defaults)
- apply friction for bursts (already supported by safety service)
- throttle endpoints for abuse patterns
- quarantine content pending review (do not delete automatically initially)

### Human-in-the-loop requirements
Automation may:
- suggest actions (L1)
- execute reversible frictions (L2) with strict thresholds

Automation must NOT (initially):
- permanently ban
- permanently remove content
- take legal/compliance actions

## Workflows
### Report workflow
1) Report created (in-app) → enters queue
2) De-dupe by `target_id` and bucket similar reports
3) Triage:
   - severity score
   - queue routing
   - suggested action (agent-assisted)
4) Review:
   - reviewer sees evidence pack + history
   - chooses action + reason codes
5) Execution:
   - apply friction/restriction/action
   - notify user (where appropriate)
6) Post-action monitoring:
   - re-offense checks
   - reversal quality sampling

### Appeal workflow
1) User submits appeal
2) Auto-attach evidence (original action, policy, snapshots)
3) Human review
4) Resolve:
   - uphold (no change)
   - modify (reduce severity / shorten duration)
   - overturn (restore)
5) Emit `safety.resolved` + update audit

### Content quarantine workflow (recommended)
- Quarantine hides from distribution but keeps the object retrievable for review.
- Used for uncertain cases (misinfo, harassment context).

## Evidence pack (critical)
Every action should reference evidence:
- content snapshot (body/media)
- context (thread, replies)
- reporter info (redacted)
- prior enforcement
- relevant events (correlation IDs)
- model outputs (if used) with version + confidence

Store evidence in an immutable store; never rely on live content alone.

## User transparency
### In-app notifications
- explain the action in user-friendly terms
- provide appeal path
- avoid revealing internal detection details

### Internal transparency reports (later)
- publish aggregate stats (takedowns, appeals, reversals) by category

## Compliance & security
### Access controls
- CSAM queue requires special role + restricted auditing.
- Legal holds restrict deletion/retention expiry.

### Audit requirements
Record:
- who viewed what
- who acted, when, why
- what evidence supported it
- what policy version applied

## Integrations
- **Safety service**: reports, flags, frictions, appeals (source of truth)
- **Discourse**: content moderation status, deletions, thread locks
- **Identity**: account restrictions, deletion state
- **Notifications**: user messaging about actions
- **Agent layer**: triage suggestions + reversible automations

## Metrics
- Queue backlog + time-to-first-action
- Appeal rate + overturn rate
- Repeat-offense rate
- False positive rate (sampled)
- Agent suggestion acceptance rate (and error rate)


