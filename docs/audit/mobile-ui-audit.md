# Mobile UI Audit (Trybl)

Goal: reconcile Trybl mobile with **baseline parity** (familiar social primitives), while keeping Trybl’s differentiators first-class and enforcing the **Parallel World model**:

- **Tribal World (default)**: Trybe-scoped, calm, stable.
- **The Gathering (time-bound)**: cross-Trybe, global trends, different weighting.

The app is always in exactly one world at a time. **No Gathering tab. No mode toggle.**

## Navigation (persists across worlds)
- Tabs: Home, Search, Inbox, Profile
- Compose: modal route `Compose` (FAB to add)
- World switching: automatic (based on purge status), **without** exposing a Gathering route/tab.

## Requirements sources (high-signal)
- Product: `docs/product/*` (verification UX, SCS, topics/feeds, notifications)
- UI: `docs/ui/*` (interaction contracts, list behavior, accessibility)
- Screens inventory: `apps/mobile/src/screens/*`

## Screen inventory (from code)
Top-level folders:
- Entry: `screens/entry/*` (boot, maintenance, offline, blocked)
- Auth: `screens/auth/*` (+ verification intro)
- Onboarding: `screens/onboarding/*`
- Home: `screens/home/*` (feed, thread, compose)
- Content: `screens/content/*`
- Profile: `screens/profile/*`
- Notifications: `screens/notifications/*`
- Settings: `screens/settings/*`
- Safety: `screens/safety/*`
- Gathering: `screens/gathering/*` (takeover mode only)
- Cred: `screens/cred/*`
- Errors: `screens/errors/*`
- Status: `screens/status/*`
- Dev: `screens/dev/*`

## Gap matrix (seed — to fill)
Legend: ✅ implemented, 🟨 partial, ⛔ missing

| Area | Capability | Status | Notes |
|---|---|---:|---|
| Shell | Baseline tab navigation (Home/Search/Inbox/Profile) | ✅ | Implemented in nav |
| Shell | Compose as floating action button | ✅ | FAB implemented via custom tab bar (`TabBarWithFab`) → `Compose` modal |
| Shell | Avatar in bottom-right nav | ✅ | Profile tab icon is the user avatar |
| Feed | Post row (avatar + meta + actions) | ✅ | `PostRow` recipe used |
| Feed | Filter UX (chips/search) not forms | 🟨 | Pills used for tabs/filters; Home topic filter still a form field |
| Thread | Bottom composer bar (sticky) | 🟨 | Composer exists; needs “always-present” sticky bar + keyboard polish |
| Gathering | Global mode, no route/tab | ✅ | World-aware feed + one-time exit collapse overlay on world transition |
| SCS | Visible where it matters (row + profile) | 🟨 | SCS now shown in Profile + PostRow; needs explanation affordance copy |
| Verification | Canonical flow per `verification-ux.md` | 🟨 | Screens exist; copy + flow needs lock |

## Execution Canvas (authoritative)

This section is copied directly from your “Complete Product & Interface Audit” canvas and is treated as the **single source of truth** for baseline parity + differentiators.

### 0. CORE WORLD MODEL (LOCKED)

Trybl operates in two mutually exclusive application worlds:
- Tribal World (default reality)
- The Gathering (parallel universe, time-bound)

Gathering is not a tab, route, or feature. It is a global application mode that alters UI, sorting, visibility, and interaction rules.

The app is always in exactly one world at a time.

### 1. TRIBAL WORLD (DEFAULT MODE)

**Purpose**: Belonging, context, continuity, reflection.

**Global Rules**
- Feed is scoped to one Trybe only
- Identity, SCS, and credibility are calibrated within generational context
- Cross-Trybe content is hidden
- UI is stable, calm, and familiar

**Gathering Presence (Unobtrusive Only)**
- Small countdown indicator
- Eligibility status (“You’ve earned access” / “Participate to earn access”)
- No preview content

### 2. THE GATHERING (PARALLEL WORLD)

**Purpose**: Perspective collision, disruption, worldview expansion.

**Entry**
- Time-based
- Automatic (no opt-in)
- App switches worlds at start time

**Exit**
- One-time collapse animation
- Occurs automatically if present, or on first return within 24h
- No replay, no archive

**Global Rules**
- Feed becomes cross-Trybe
- Trybe becomes metadata, not boundary
- Sorting emphasizes cross-generational resonance
- Trends are global
- Posting/replies default to all Trybes

### 3. GLOBAL NAVIGATION (PERSISTS ACROSS WORLDS)

Same navigation, different behavior depending on world:
- Home (Trybe / Gathering feed)
- Compose
- Search
- Inbox (DMs + notifications)
- Profile

No Gathering tab. No world toggle.

### 4. BASELINE PARITY — FEATURES THAT MUST EXIST

High-level parity checklist (to expand into a full gap table):
- A. Account & Identity
- B. Onboarding & Verification
- C. Profile System
- D. Posting
- E. Conversation & Interaction
- F. Feed & Discovery
- G. Search
- H. Lists & Curation
- I. Messaging (DMs)
- J. Notifications
- K. Safety & Moderation

### 8. NON-GOALS (ABSOLUTE)
- No Gathering tab
- No mode toggle
- No gamification
- No influencer mechanics
- No paid verification
- No personal data sales

### 9. DEFINITION OF DONE (AUDIT COMPLETE)
- Every baseline feature has a Trybl location
- Every screen behaves correctly in both worlds
- Gathering is implemented as a global mode
- UI differences reinforce parallel-universe psychology
- No feature violates locked principles

## Parity checklist (A–K) — implementation map

Legend: ✅ implemented, 🟨 partial, ⛔ missing

| Section | Feature | Status | Where / notes |
|---|---|---:|---|
| A | Account creation | ✅ | `screens/auth/Register.tsx` |
| A | Login / logout | ✅ | `screens/auth/Login.tsx`, `Logout.tsx` |
| A | Password reset | ✅ | `Forgot.tsx`, `Reset.tsx` |
| A | Session management | ✅ | Sessions list + revoke + logout-everywhere UI (mock-backed) |
| B | VerifyIntro explainer | ✅ | `screens/auth/VerifyIntro.tsx` |
| B | OTP verification | ✅ | `screens/auth/OTP.tsx` |
| B | Profile setup (name/handle/avatar) | ✅ | `EditProfile.tsx` supports name/bio + local avatar stub; persists in dev session |
| B | Trybe assignment confirmation | ✅ | `screens/onboarding/TrybeConfirm.tsx` wired after generation verification |
| C | My profile (avatar/bio/handle/Trybe/SCS) | ✅ | Profile header shows avatar/bio/handle/Trybe + SCS with explainer sheet |
| C | User profile + follow/unfollow | 🟨 | Local follow parity stub in `screens/profile/ProfileOther.tsx`; backend wiring pending |
| C | Block/mute/report from profile | 🟨 | Block/report wired; local mute parity stub added; backend wiring pending |
| D | Create post (text) | ✅ | `screens/home/ComposeEntry.tsx` |
| D | Media in posts | 🟨 | Local media attachment (sample asset) + rendering in `PostRow`/`ContentDetail`; device picker requires native module/backend |
| D | Mentions/hashtags/topics | 🟨 | topics exist; lightweight @/# parsing + topic pages implemented; hashtag search/back-end pending |
| D | Delete post | 🟨 | Local delete implemented in `ContentDetail` for local posts; backend delete pending |
| D | AI disclosure toggle | ✅ | `ComposeEntry.tsx` toggle persists to local posts; `PostRow` shows muted disclosure |
| E | Reply (threaded) | ✅ | Thread view + sticky composer bar + reply-to-reply affordance via focus |
| E | Like / repost | ✅ | Persisted dev-mode interactions via `storage/interactions.ts` + `PostRow` |
| E | Share | ✅ | Native share sheet wired (text share) |
| E | Bookmark | ✅ | Persisted + Bookmarks tab in Profile |
| F | Tribal home feed (Trybe-only) | 🟨 | scoped in mocks + client enforcement; backend enforcement pending |
| F | Gathering feed (cross-Trybe) | 🟨 | uses `gatheringTimeline()` when active; backend enforcement pending |
| F | Trends (Trybe/global) | ✅ | World-scoped trends surfaced as topic pills on Home (and searchable topics on Search) |
| G | Search posts/users/topics | 🟨 | `screens/search/Search.tsx` local index search (posts/people/topics); backend search pending |
| H | Lists & list timelines | 🟨 | Local lists + timelines + add-items flow (`screens/lists/*`, `storage/lists.ts`); backend wiring pending |
| I | DMs + requests | 🟨 | Local messaging store + thread screen + safety actions; backend wiring pending |
| J | Notifications inbox | 🟨 | UI exists; backend types + real-time updates pending |
| K | Report content/user | ✅ | `screens/safety/*` report flow |
| K | Block | ✅ | `screens/profile/BlockUser.tsx` |
| K | Mute | ✅ | Local mute state + feed/search/topic filtering for muted handles |
| K | Appeals | 🟨 | UI exists; end-to-end requires backend appeal endpoints + status polling |


