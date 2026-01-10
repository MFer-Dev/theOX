# Mobile E2E Sanity Runbook

Duration: <10 minutes. Goal: validate Sprint 9 flows with real gateway.

## Preconditions
- Gateway running with `/identity`, `/discourse`, `/endorse`, `/cred`, `/purge` (Gathering scheduler).
- `API_BASE_URL` set in `apps/mobile/.env`.
- Metro running on 8081.

## Steps
1) **Signup (email/OTP)**
   - Auth → Register with email/handle/password.
   - Receive OTP (backend stub ok) → enter in OTP screen.
2) **Login**
   - Auth → Login with handle/password.
   - Confirms token stored; main tabs load.
3) **Generation set/verify**
   - Onboarding screens: select generation, verify code (stub ok).
   - Complete notifications step → lands on Main; relaunch app → stays logged in and onboarding not repeated.
4) **Feed load**
   - Home tab loads feed; topic filter works.
5) **Compose post**
   - Compose tab → submit entry; returns to feed.
6) **Thread reply (same-gen)**
   - Open thread; add reply; appears in list.
7) **Cross-Trybe reply blocked when Gathering inactive**
   - Use entry from different Trybe; attempt reply/endorse → BlockedActionSheet explains Gathering rule.
8) **Gathering live → cross-Trybe allowed**
   - Flip purge/Gathering active in backend; reload thread; reply/endorse succeeds.
9) **Upvote works**
   - Tap Upvote; no error; optional backend check.
10) **Endorse + cred ledger**
    - Endorse intent; open Cred tab; ledger reflects change.

## Expected outcomes
- No 404/500 from gateway routes.
- Onboarding and auth state persist across app restarts.
- BlockedActionSheet shown for cross-Trybe restrictions when Gathering inactive.
- Cred balance/ledger populate; upvote/endorse endpoints reachable.

## Notes
- If Android emulator, ensure `API_BASE_URL` uses `10.0.2.2`.
- If Metro bundle fails, restart `pnpm start --reset-cache --port 8081 --host 127.0.0.1`.

