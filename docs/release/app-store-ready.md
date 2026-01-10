# App Store Ready — acceptance checklist (v1)

## Product (must)
- Core loops: **read → react → compose → reply → follow/mute → search → DM**
- Parallel World model: **Tribal default**; Gathering takeover; no toggle/tab
- Verification: send OTP + verify; clear copy; no dead ends
- Sessions: view sessions + revoke + logout everywhere; revoked sessions blocked immediately
- “Why you saw this” present on ranked feed items
- Trust-through-design: Data Covenant + ranking transparency screen exists

## UX polish (must)
- No placeholder buttons that do nothing on primary surfaces
- No “dev” affordances visible in production builds
- Calm error states: offline, unauthorized, rate limited, gathering dissolved
- Consistent navigation + safe-area + keyboard behavior (thread composer)

## Compliance baseline (must)
- Privacy Policy + Terms links reachable in-app (About)
- Data collection disclosures documented (Data Covenant)
- No prohibited brand references (no “Twitter/tweet” strings)

## Technical (must)
- Mobile: typecheck clean; no red screens on common flows
- Backend: smoke tests pass; world rules enforced server-side

## Post–App Store hardening (next sweep)
- Observability: Sentry, tracing, log dashboards
- Abuse: per-user rate limits, device binding hardening, anomaly detection
- Media pipeline: real upload, moderation hooks
- QA gates: CI, test matrix, manual checklist + release notes


