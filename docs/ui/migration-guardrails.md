# Tamagui Migration Guardrails

- Scope: UI-only migration. **Do not change backend, contracts, or routes.**
- Gateway is the only API surface; mobile uses `API_BASE_URL` exclusively.
- Route prefixes are locked: `/identity`, `/discourse`, `/endorse`, `/cred`, `/purge`, `/notes`, `/safety`.
- Screen imports rule: screens must import components/layout from `apps/mobile/src/ui` (recipe layer). Direct `tamagui` imports only in documented edge cases inside `src/ui/*`, not in screens.
- Gathering theme constraint: Gathering visuals map to the existing `purge` theme and may only alter accent/badges/banners/subtle tint. No spacing/typography/sizing changes between themes.
- No Storybook for this migration.
- No new UI paradigms; recipes/wrappers in `src/ui` are the system and are reused everywhere.

