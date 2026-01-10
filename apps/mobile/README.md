# Mobile (React Native)

## Setup
- Install JS deps: `pnpm install`
- iOS pods: `cd ios && LANG=en_US.UTF-8 pod install`
- Android SDK path: ensure `sdk.dir` in `android/local.properties` (e.g. `/Users/mateo/Library/Android/sdk`)
- Env: create `.env` from `.env.example` with `API_BASE_URL=http://localhost:4000`
  - iOS Simulator can use `http://localhost:4000`
  - Android Emulator should use `http://10.0.2.2:4000`
  - Physical device: use your Mac LAN IP (e.g., `http://192.168.x.x:4000`)

## Run
- Start Metro (we pin to port 8081): `pnpm exec react-native start --reset-cache --port 8081 --host 127.0.0.1`
- iOS: open `ios/GenMobile.xcworkspace` or run `pnpm ios`
- Android: `pnpm android` (emulator running) or `./gradlew assembleDebug` under `android/`

## Troubleshooting
- Pods locale: set `LANG=en_US.UTF-8` before `pod install`
- Android “SDK location not found”: update `android/local.properties`
- Gradle plugin path: already resolved for pnpm layout in `android/settings.gradle`
- If API calls fail on Android emulator, confirm `API_BASE_URL` uses `10.0.2.2`
- Metro shims: we alias Node modules used by shared/gateway code (`crypto`, `util`, `net`, `tls`, `url`, `stream`, `events`, `fs`, `path`, `dns`) in `metro.config.js`. If you see a “Cannot resolve module <name>” screen, restart Metro with the command above to pick up the aliases.
- Xcode Debug env vars: set `RCT_METRO_PORT=8081`, `RCT_METRO_HOST=127.0.0.1` (Scheme → Run → Arguments → Environment Variables). Clean Build Folder after changing Metro state.

## Theme & Tokens (Sprint 8B)
- Tamagui config: `tamagui.config.ts` with themes `default` and `purge` (`purge` maps to The Gathering visuals; only accent/badges/banners adjust).
- Recipe layer: screens must import from `src/ui` (primitives + recipes). Do not import Tamagui directly in screens.
- Tokens/scales encoded in `src/ui/recipes/*` and primitives under `src/ui/primitives/*`.

## API Status Screen
Use the “Status” tab to see:
- Current API base URL
- `/healthz` status
- Gathering state

