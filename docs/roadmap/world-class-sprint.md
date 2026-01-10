# World-class Sprint Plan (rolling)

This repo is being advanced toward a production-grade, premium social product with Trybl’s **Parallel World** model as the organizing principle.

## Non-negotiables (locked)
- **No Gathering tab**, no mode toggle
- **Server-authoritative world clock**
- **No Gathering writes after end** (server rejects; client shows calm dissolved state)
- **Data Covenant**: no personal data sales; derived-only insight products; no personal exports
- **Transparency**: ranking provides “why you saw this”

## Now implemented (high signal)
- **World clock SSE**: `/world/stream` from gateway
- **Gathering off-ramp + dissolve UX** (mobile) + backend write rejection
- **Feed ranking**: `feed_rank_v1` with `rank.why[]` explanation
- **Semantic layer**: derived-only aggregates + `/insights/*` with k-anon + API key guard
- **Sessions + refresh rotation**: Identity refresh token rotation with `sid`
- **Mobile auth**: device id + automatic refresh + retry for 401s
- **Edge session enforcement**: gateway checks `sid` active (revoked sessions blocked immediately)
- **Verification send**: OTP send wired from mobile Verify flow

## Next tranche (to reach “world-class”)
### 1) Trust-through-design surfaces (mobile)
- Add a **Trust & Transparency** screen:
  - Data Covenant summary
  - “How ranking works” (simple, human copy)
  - “Why you saw this” explainer and controls (e.g. mute, hide topic)

### 2) Media pipeline (real)
- Signed upload URL → upload → attach → render
- Basic content safety hooks

### 3) Reliability & observability
- Structured logs + correlation ids across all services (already partial)
- Sentry wiring (mobile + gateway)
- Rate limits per-user/per-endpoint

### 4) Search quality + discovery
- Indexing + ranking (recency + diversity)
- Topic pages with “related topics” + cross-trybe expansion in Gathering

### 5) Messaging polish
- Request inbox polish + safety affordances
- Read receipts/unread consistency


