# Social Credit Score (SCS) — Sprint 20

## Purpose
- Single meaningful public signal replacing likes/views.
- Values conversation depth, credible interaction, and integrity; not raw volume or vanity.
- Exists per post (visible badge) and per user (header-only, no ranks/leaderboards).

## Display model (public, non-game)
- Label: “Social Credit” (or “SCS” where space is tight).
- Single number, compact notation, no decimals (e.g., 12, 240, 2k, 3m).
- Neutral styling; no gradients, trophies, streaks, trend arrows, or percentiles.

## Trust-weighted interactions (user-facing explanation)
- Not all interactions count equally.
- Credible participation carries more weight over time.
- Sustained, constructive engagement matters more than bursts or volume.

## Inputs (event-based, conceptual)
- Post created, reply created, reply receives replies (depth), reaction, share/bookmark (if present), report outcomes.
- Weighted by Trust Weight (TW) of the actor; actionWeight (reply > reaction), depthWeight (log growth), noveltyWeight (penalizes repetition), qualityWeight (outcomes).
- Diminishing returns: log/sqrt scaling; daily post saturation to prevent volume gaming. One post that drives deep conversation outweighs many low-response posts.

## Trust Graph / Trust Weight (TW)
- Nodes: users, content, interactions. Edges: verified identity, positive interactions, upheld reports, AI disclosure.
- TW increases with sustained good behavior/verification; decreases with upheld abuse or undisclosed AI.
- TW is internal; it modulates SCS deltas but is not shown.

## Eligibility tie-in (Gathering)
- Eligibility is satisfied by either:
  - Minimum SCS delta earned inside your Trybe during the cycle, OR
  - Qualifying actions (post or reply or active read threshold).
- UI language: “You’ve earned access.” No grading/shaming copy.

## AI disclosure and SCS
- Compose includes “Assisted by AI” toggle; disclosed posts are labeled subtly and incur no SCS penalty.
- Undisclosed AI (when confirmed) reduces TW and dampens SCS deltas; repeated violations feed the enforcement ladder. No hard drops; penalties are weighted/dampening.

## Enforcement transparency & safety
- Public warnings/restrictions must show human-readable reason codes.
- Appeals allowed (rate-limited); users can seek review.
- Rehabilitation path: non-severe cases recover over time as good behavior accrues (SCS can rebound).

## Progressive enforcement (no cliffs)
- Soft friction (reduced visibility/post rate) → warning (private) → temporary restriction (read-only, Gathering ineligible) → suspension → ban (after repeated/severe).
- No leaderboards, no public ranks, no gamification, no badges/NFTs/monetization.

