# Trybl Master Backlog (What’s Missing)

This is the **authoritative backlog** of everything still missing to reach the product you described: a premium, App‑Store‑ready social app with Trybl’s **Parallel World model** (Tribal World vs The Gathering), strong trust/safety primitives, and a meaningful credibility system.

Legend:
- ✅ done
- 🟨 partial
- ⛔ missing

> Note: This backlog is intentionally strict: if something is “technically present” but not **designed, coherent, and production‑ready**, it is listed here.

## 0) Critical blockers (must fix before any “polish”)

- ⛔ **World labeling + identity is unmistakable**
  - ⛔ **Gathering header identity**: consistent “Gathering” brand lockup (wordmark + subtle rule chip + countdown), not just a theme shift.
  - ⛔ **Tribal header identity**: clear “Trybl / Tribal” identity without explanatory paragraphs.
  - ⛔ **World indicator is persistent**: visible on every primary surface (Home/Search/Inbox/Profile) in a minimal way.
  - ⛔ **World transition UX**: enter/exit overlays are present but need final designed copy (“why you were ejected”, “world dissolved”, what gets lost).

- ⛔ **Identity signals are legible + accessible (generation + status)**
  - 🟨 **Generation ring**: visible on avatars (implemented), but needs consistent rules and polish across all surfaces.
  - ⛔ **SCS “status badge” system** (like verified-style badges):
    - ⛔ Define **status classes** (by SCS bands) and their badge colors (e.g., Bronze/Silver/Gold/Onyx—final naming TBD).
    - ⛔ Render a compact badge next to the handle (and optionally on profile header).
    - ⛔ Badge is **tappable** → popover/sheet explaining what the class means and how it’s earned (non-gamey).
  - ⛔ **Accessibility contract**:
    - Generation ring and status badge must be discoverable with VoiceOver (role, label, hint).
    - Taps open an explanation surface (sheet/popover) with clear copy.

- ⛔ **Safe-area / layout system is deterministic**
  - ⛔ No double-safe-area insets (header vs screen), no content hidden behind FAB/tab bar, no overlapping chips/cards on any screen size.
  - ⛔ Keyboard + composer behavior is deterministic (Thread composer, Compose modal, DM composer).

- ⛔ **Theme system is finalized**
  - 🟨 **Light theme**: premium tokens + contrast tuned (not “bootstrap”).
  - 🟨 **Dark theme**: premium tokens + contrast tuned.
  - 🟨 **Gathering theme**: distinct tint/temperature + density/motion differences (not just dark).
  - ⛔ Per-world iconography + accent rules (e.g. urgent compose in Gathering, calm in Tribal).

## 1) The Gathering (Parallel World) — missing “Trybl-ness”

- 🟨 **Gathering takeover behavior**
  - ⛔ **Gathering UI contract per surface**
    - ⛔ Home: sticky filter bar + global trends + special ranking affordances (no extra copy).
    - ⛔ Search: Gathering-specific filters (Trybe, generation, topic) in-surface, not Settings.
    - ⛔ Inbox: request handling and “dissolve” error mapping for DM sends.
    - ⛔ Profile: what changes in Gathering vs Tribal (viewing rules, actions allowed).
  - ⛔ **Gathering “rules chip”** (non-interactive) + “why this exists” microcopy (very short).
  - ⛔ **Hard no-drafts / no-replay enforcement (end-to-end)**
    - 🟨 Backend rejects writes after `ends_at` (some discourse endpoints enforce; must be uniform across all write surfaces: posts, replies, DMs, lists, etc).
    - ⛔ Mobile maps failures to a calm “Gathering dissolved” state everywhere (compose/reply/dm/list add).
  - 🟨 **Real-time world clock** (SSE exists) but needs:
    - ⛔ client connection status UX (silent, non-annoying) + robust reconnect handling
    - ⛔ server-authoritative event types + versioned contract

- ⛔ **Gathering content model**
  - ⛔ Gathering posts are ephemeral: TTL semantics + “not archived” enforcement and UI messaging.
  - ⛔ Cross‑Trybe diversity cues are visible (e.g., Trybe label, generation mix, “perspective collision” affordance).

## 2) SCS / Credibility / TrustGraph — currently not meaningful enough

- 🟨 **SCS UI presence exists** but meaning is not there:
  - ⛔ **SCS explainer must be actionable**:
    - What inputs change SCS (endorsements, quality ratio, cross-gen delta, flags).
    - What SCS unlocks/restricts (rate limits, posting privileges, Gathering eligibility boosts).
  - ⛔ **SCS breakdown screen**
    - “Your SCS today” + trend line
    - contributing factors (non-gamey)
    - recent events influencing it (“+ thoughtful reply”, “- unlabeled AI assist”, “- spam flags”)
  - ⛔ **SCS shown where it matters**
    - feed rows: subtle but tappable; not just a number
    - profile: deeper breakdown
    - moderation states: “restricted” linked to trust status

- ⛔ **Backend credibility contract**
  - ⛔ TrustGraph must publish a stable API: `/trust/me`, `/trust/user/:id`, `/trust/explain/:contentId`
  - ⛔ k‑anonymity + covenant rules enforced for any insights
  - ⛔ event-driven updates from discourse/messaging/endorse/safety
  - ⛔ admin-only audit views (after app is wrapped)

## 3) Identity, Verification, Uniqueness (mandatory & free)

- 🟨 OTP flows exist, but production requirements missing:
  - ⛔ Real SMS/email provider integration (Twilio/Sendgrid/etc) + abuse controls
  - ⛔ Uniqueness verification strategy (device binding + anti-sybil) with privacy constraints
  - ⛔ Age verification UX is “must-pass” gating (no dead ends)
  - ⛔ Refresh token rotation hardening + device/session revocation propagation across gateway/services

## 3.1) First-use onboarding (tour) + consent (Terms) — missing

- 🟨 **Onboarding exists** (some screens), but missing the required first-use tour:
  - ⛔ **First-use onboarding carousel**
    - 3–5 premium slides with clear illustrations + concise copy + CTA.
    - Dismissible with an **X** (always available).
    - Final step routes to **Create account / Login** (no dead ends).
  - ⛔ **World model explained** (in tour, not in feed UI):
    - Tribal World vs The Gathering, what changes, what doesn’t.
    - “No archives during Gathering” + “writes rejected after dissolve”.

- ⛔ **Terms / Privacy acceptance (transparent + elegant)**
  - ⛔ In auth/onboarding, require explicit acceptance:
    - “By continuing, you agree to Terms and Privacy” with links.
    - Optional: checkbox/toggle for explicit consent (depending on legal requirement).
  - ⛔ Provide in-app accessible pages for:
    - Terms of Service
    - Privacy Policy
    - Licenses
  - ⛔ Ensure acceptance is persisted and auditable (backend record + versioned policy IDs).

## 4) Core social parity — still incomplete in “real app” terms

- 🟨 **Feed interactions**
  - 🟨 like/repost/bookmark/share exist; need:
    - ⛔ consistent “quote” flow UX across all surfaces
    - ⛔ “repost with comment” composer variant
    - ⛔ undo + optimistic updates + error reconciliation

- 🟨 **Threading**
  - 🟨 thread view exists; need:
    - ⛔ true sticky composer (always present, keyboard safe)
    - ⛔ low-signal replies visually muted (and defined)

- 🟨 **Search**
  - 🟨 backend-driven search exists, but UX needs:
    - ⛔ unified result tabs (posts/people/topics) without explanatory copy
    - ⛔ Gathering-only filters in-surface

- 🟨 **Messaging**
  - 🟨 threads + requests exist; need:
    - ⛔ requests accept/decline polish + clear system states
    - ⛔ unread + read receipts rules (even if minimal)
    - ⛔ abuse/report/block flows inside DM

- 🟨 **Lists**
  - 🟨 lists exist; need:
    - ⛔ list edit flow polish (rename/description/privacy)
    - ⛔ list timelines ranked + world-aware behavior

## 5) Media pipeline (real, safe, scalable)

- 🟨 Media upload exists (dev/base64). Missing:
  - ⛔ real multi-part upload flow (S3/GCS presigned URLs)
  - ⛔ media transformations (thumbnails, sizes), caching headers
  - ⛔ moderation hooks (hashing, CSAM checks, policy scanning)
  - ⛔ video support (upload, playback, poster frames)

## 6) Premium UI / motion / density (across all surfaces)

- ⛔ Typography scale + hierarchy pass (remove unnecessary headings everywhere)
- ⛔ Consistent spacing system across sections/cards/lists
- ⛔ Surface rules: when to use cards vs flat list separators
- ⛔ Gathering vs Tribal physics:
  - density shift
  - subtle motion differences
  - subtle color temperature shift

## 7) Trust-through-design (system states)

- ⛔ Designed states for:
  - blocked/restricted
  - verification required
  - gathering dissolved mid-action
  - rate limited
  - offline
  - media upload failures

## 8) Observability / abuse / reliability (post–App Store sweep, but backlog now)

- ⛔ Sentry integration (mobile + backend) + release tags
- ⛔ structured logs + correlation IDs end-to-end (partially present)
- ⛔ rate limits per endpoint + per device + per user (gateway-only best-effort exists; needs service-level)
- ⛔ abuse detection (spam bursts, sybil heuristics)
- ⛔ QA gates + CI hardening + smoke tests for core flows

## 9) Data Covenant + Semantic IP (core monetization layer)

- 🟨 docs exist, partial service exists; missing:
  - ⛔ canonical event taxonomy (what is emitted where; versioning)
  - ⛔ stable query APIs for semantic products (generation segment insights)
  - ⛔ “Why you saw this” explanations fully integrated and user-legible
  - ⛔ topic affinity computation + user controls (non-gamified)

## 10) Test data & QA workflows

- 🟨 QA seeding exists; missing:
  - ⛔ predictable Gathering window test mode (dev-only) + reset tools
  - ⛔ scripted QA checklist per screen with screenshots + expected behavior

---

## Immediate next epics (recommended)

1) **World Identity + Gathering Contract** (labeling + header + sticky filters + rules chip + exit explainer)
2) **SCS: meaningful, explainable, non-gamey** (breakdown screen + trust APIs + event-driven updates)
3) **Layout + Safe-Area System** (no overlaps, no dead bands, keyboard-safe composers)


