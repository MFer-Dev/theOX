# Privacy + Data Governance (Spec)

## Purpose
Meet App Store expectations and regulatory reality while enabling GenMe to operate:
- clear consent + policy acceptance
- data minimization + retention windows
- user rights (export, deletion)
- deletion propagation across services
- secure handling of PII

## Data classification
### Classes
- **Public**: content intended for public viewing (posts, topics).
- **Account**: user profile fields, sessions/devices.
- **Sensitive PII**: email/phone, IP, device identifiers, tokens.
- **Highly sensitive**: safety reports, CSAM-related materials, legal holds.

### Handling rules
- Default to least collection needed.
- Redact sensitive PII in logs/analytics.
- Encrypt sensitive data at rest (KMS-managed keys).

## Retention policy (default targets)
These are starting points; adjust with counsel:
- Auth/session logs: 90 days
- Device/IP signals: 30–90 days
- Safety audit logs: 1–3 years (depending on compliance needs)
- Raw analytics events: 13 months (common industry baseline)
- Derived aggregates: longer, if k-anon and non-identifying

## User rights (self-serve + support)
### Export
- Provide “Download my data” in-app and via Admin Console.
- Export package includes:
  - profile fields
  - posts/replies/media references
  - settings/preferences
  - policy acceptance record
- Exclude: internal safety signals and reviewer notes (unless legally required).

### Deletion
- In-app self-serve deletion (already scaffolded in identity)
- Deletion semantics:
  - immediate session revocation
  - soft-delete content (author removed/anonymized)
  - revoke push tokens
  - propagate deletion to all services via `identity.account_deleted` event

### Legal hold
- Freeze deletion/retention expiry for a user/content under investigation.
- Requires compliance role + audit justification.

## Deletion propagation contract
### Required behavior per service
- On `identity.account_deleted`:
  - stop showing the user in search/results
  - soft-delete or anonymize authored content as appropriate
  - revoke tokens and sessions
  - prevent future writes from that identity

### Verification
- Automated smoke checks:
  - deleted users cannot authenticate
  - deleted users not returned by public profile/search
  - authored content behaves per policy (removed/anonymized)

## Consent + policy acceptance
- Store policy version acceptance per user (already scaffolded)
- Enforce “policy gate” at login/session refresh
- Admin Console shows acceptance state and versions

## PII vault pattern (recommended)
Store sensitive PII in a dedicated store/service:
- reduces blast radius
- simplifies access controls
- makes redaction/encryption consistent

## Audit requirements
Audit log (tamper-evident) records:
- admin access to sensitive panels
- exports performed
- deletions performed
- policy changes and approvals

## Agent constraints
Agents:
- do not see raw PII by default
- can operate on redacted identifiers
- require explicit approval for exports/deletions and policy changes


