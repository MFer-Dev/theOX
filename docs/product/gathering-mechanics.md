# The Gathering Mechanics (Sprint 18)

## Mental model
- Default: users live in their Trybe (generation) most of the week.
- The Gathering: weekly, time-bound, anticipated global timeline; earned via Trybe participation.

## Eligibility (per cycle)
- Eligible if the user has done at least one: post, reply, meaningful react/endorse, or active reading time in their Trybe.
- Resets every Gathering; binary eligible/ineligible.

States:
- Eligible: full access.
- Ineligible — action required: show checklist + CTA to Trybe.
- Ineligible — time remaining: countdown + reminder.
- Eligible — used (future): if capped/rate-limited.

## Timeline behavior
- During Gathering: global feed (all Trybes), new posts allowed; replies threaded.
- When window ends: timeline freezes for new top-level posts; replies stay open.
- History: past Gatherings selectable; read-only for new posts; replies allowed; original ordering preserved.
- Filters: Trybe, topic/trend, engagement velocity, sentiment cluster (when supported).
- Search: cross-Trybe default during Gathering; can scope to a single Trybe.

## UI surfaces
- Countdown banner (global): next window + eligibility chip; tap → eligibility screen.
- Eligibility screen: status, checklist, progress, CTA “Go to my Trybe”.
- Locked state (live but ineligible): “The Gathering is live / you’re not eligible this time” + “Return to my Trybe”.
- Gathering timeline screen: header with time remaining, filters, Trybe badges on posts, history selector.
- Post-Gathering: banner “The Gathering has ended” + “Back to my Trybe” + link to past Gatherings.

## Notifications
- “The Gathering starts in 24 hours”
- “You’re eligible for The Gathering”
- “You’re not eligible yet — participate in your Trybe”
- “The Gathering is live”
(Always include time context + next action.)

## End-of-event transition (Sprint 19)
- Authoritative end time: `gatheringEndAt`; replay window ends at `gatheringEndAt + 24h`.
- Per-cycle flag: `hasSeenEndTransitionForCycle`.
- Case 1 (in-app at end): non-dismissible 10–30s countdown; on zero, transition fires; any unsent content is lost; Gathering UI collapses; Trybe UI is revealed. No CTAs or narration.
- Case 2 (return within 24h): transition plays immediately once; user does not see Gathering timeline; optional single line “The Gathering has ended.”
- Case 3 (return after 24h): no transition; direct to Trybe UI.
- Phases: destabilize (micro jitter, degraded scroll), collapse (directional exit; elements leave screen), reveal (Trybe already present), silence (no explanation).
- Reduced motion: replace collapse with fast cut; still enforce timing and draft loss.
- Background/foreground: if app backgrounded before zero, transition plays on next foreground within 24h; clock reconciles to server time.
- Draft rule: if not sent before zero, it does not exist (no autosave/recovery).
- QA: typing during countdown loses content; scrolling locked on collapse; return at +23h plays; return at +25h does not; reduced motion uses cut.

## Analytics (display only)
- Track: eligibility conversion, Trybe participation lift, Gathering attendance, cross-Trybe interaction volume, post-Gathering retention back to Trybes.
- No leaderboards, no moral/ranking signals.

