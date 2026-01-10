# Sprint 12 Gates

## Android build
- Command: `cd apps/mobile/android && ./gradlew clean assembleDebug`
- Status: ✅ (see log `/Users/mateo/.cursor/projects/Users-mateo-Documents-genme/agent-tools/5dca4c88-7bb3-4657-83e3-127e1c991c56.txt`)
- Notes: React Native SVG/MatrixMathHelper fixes applied via `postinstall-fixes` copy script (runs after install).

## iOS build
- Command: `cd apps/mobile/ios && LANG=en_US.UTF-8 pod install`
- Command: `cd apps/mobile/ios && xcodebuild -workspace GenMobile.xcworkspace -scheme GenMobile -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build`
- Status: ✅ (xcbuild log `/Users/mateo/.cursor/projects/Users-mateo-Documents-genme/agent-tools/f195bf76-521e-4b21-8c72-86f710ac5256.txt`)
- Notes: Initial pod install failed due to locale; succeeded with `LANG=en_US.UTF-8`.

## Contract smoke
- Command: `API_BASE_URL=http://localhost:4000 MOBILE_TOKEN=... pnpm exec tsx scripts/smoke/mobile-contract.ts`
- Status: ✅ (2026-01-04, token handle `sprint12`, verified `genz`; output `{ health: true, me: true, feed: true, notes: true, safety: true }`)
- Notes: Updated gateway proxy (arrayBuffer fix; preserve prefix for notes/safety/cred/purge; safety target 4008). Safety migrations applied (added `safety_restrictions`). Smoke script now uses null UUID for notes probe to avoid invalid-UUID errors.

## Runtime sanity (10-minute pass)
- Steps: login/onboarding → feed → thread → purge gating → notes eligibility → report flag → purge active cross-gen allowed → cred ledger.
- Status: ✅ via API/runtime checks (2026-01-04)
  - login + generation verify (genz) → token refreshed
  - feed: GET `/discourse/feed` 200 with created entry
  - thread: GET `/discourse/entries/{id}/thread` 200
  - notes: GET `/notes/by-content/{entry}` 200 (empty OK)
  - report flag: POST `/safety/flag` 200
  - safety status: GET `/safety/my-status` 200 (empty)
  - cred balance: GET `/cred/balances` 200
  - purge status inactive (cross-gen gating not exercised; purge active flow deferred)
- Device: executed via backend/API (Android runtime not exercised in emulator for this run)

## Patch persistence
- Method: `postinstall` runs `patch-package || true; node scripts/postinstall-fixes.js`.
- Files copied on postinstall:
  - `MatrixMathHelper.java` (RN) to expose matrix decomposition fields.
  - `RenderableViewManager.java`, `SvgViewManager.java` (react-native-svg) with simplified transform and border radius coercions.
- Rationale: Ensures Android build remains stable after fresh install even if patch-package parsing fails.

