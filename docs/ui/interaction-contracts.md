# Interaction Contracts (Sprint 14)

## States
- Disabled: user cannot trigger; cursor/press ignored; no loading spinner.
- Loading: action in flight; disable further input; show spinner or skeleton; should be brief and cancelable if possible.
- Blocked: precondition not met (e.g., cross-gen, safety); show reason; no retries until condition changes.

## Responses
- Optimistic: update UI immediately, reconcile on server response; must revert on failure with notice.
- Confirmed: wait for server success before reflecting change; show loading affordance.
- Retryable failure: show inline error with clear retry action; keep context.
- Terminal failure: show global notice; avoid retry loop; log and surface minimal info.

## Error surfaces
- Inline: field-level issues (validation).
- Section-level: list/section load failures.
- Global notice: cross-screen/system issues (auth, network down).
- Silent failure: never acceptable unless explicitly logged and user unaffected.

## Guidelines
- Buttons: one of {default, loading, disabled}. Loading implies disabled. Blocked uses explicit copy, not just disable.
- Forms: show helper or error per field; keep submit disabled when invalid.
- Lists: empty explains why + next action; error offers retry; loading uses skeletons.
- Overlays/sheets: block input while loading; allow cancel unless destructive.

## State matrix (valid combos)
- loading only (no error/empty)
- error only (with retry)
- empty only (with next action)
- blocked only (reason visible)
- optimistic → success | failure (rollback + error)

Invalid combos (prevent)
- loading + error
- loading + empty
- blocked + retry (blocked should give reason, not retry loop)

