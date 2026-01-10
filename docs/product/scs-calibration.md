# SCS Calibration & Stability (Sprint 22)

Principles
- Calibration should be felt, not seen. Minimal UI changes unless data proves necessity.
- Overcorrection is worse than under-correction.
- Recovery must be possible, predictable, and dignified.

Movement curves
- Early vs late velocity: slow initial SCS movement for new users; sensitivity increases after sustained participation. One good post cannot spike; one bad post cannot crater; repetition drives change.
- SCS_delta(user_age, contribution_density): early small steps; later moderate sensitivity; caps on single-event impact.

Diminishing returns
- Volume dampening coefficient: log/sqrt on posts per day; saturation kicks in for bursts.
- Reply-depth ceiling: depth contribution caps after a modest depth; ultra-long threads decay to prevent flame-war dominance.
- Viral-but-toxic decay faster; small sustained conversations remain valuable.

Thread dominance
- Max effective depth defined; decay function applied to very long threads to discourage endless loops while keeping early depth valuable.

Penalty & recovery timing
- Penalties: progressive TW decrease and SCS dampening with bounded duration; no permanent damage without repeated upheld signals.
- Recovery: time-based and behavior-based, gradual and non-shaming; rehabilitation possible after non-severe outcomes.

False positive safety
- Define acceptable false-positive rate; automatic rollback thresholds for anomalies.
- Appeals meaningfully restore SCS over time; bias must not accumulate silently.

