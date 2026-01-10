# Accessibility (Sprint 15A)

Principles
- Labels: every control has an accessibilityLabel (or obvious text). Use role (`button`, `switch`, `checkbox`) and state (`disabled`, `busy`, `checked`, `invalid`).
- Hit targets: minimum 44–48px height; enforced in buttons/inputs/toggles.
- Focus: modals/sheets mark `accessibilityViewIsModal`; avoid trapping but keep backdrop dismiss reachable.
- Screen readers: avoid redundant labels; use helper/error for hints; blocked vs disabled must announce correctly.
- Reduced motion: motion presets respect OS reduce-motion (durations collapse to 0, animations removed).
- Color/contrast: rely on tokens; no inline colors.

Checklist (apply at recipes/primitives)
- Buttons: role=button, minHeight≥48, accessibilityState {disabled/busy}, loading implies disabled.
- Inputs: label/hint wired; accessibilityState.invalid on errors.
- Toggles/checkbox: role and checked state set.
- Sheets/overlays: `accessibilityViewIsModal`, closing via back/backdrop.
- Lists: rows use semantic buttons for primary action; tap targets ≥48px.
- KitchenSink: includes reduced-motion indicator, focus/labels examples, error/empty/blocked states, and large-list stress to validate screen reader output.

