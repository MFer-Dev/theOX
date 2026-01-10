# QA Checklist (Manual) — Trybl Mobile

## Identity + Legal
- **Login / Register**: create account, login works
- **Terms gate**: after login, if not accepted, Legal screen blocks app
- **Terms/Privacy**: open Terms + Privacy screens from Legal + About
- **Accept**: “I agree & continue” persists (relaunch → not shown again)

## Worlds
- **Tribal default**: app loads into Tribal world when purge inactive
- **Gathering forced**: run `pnpm exec tsx scripts/dev/worldctl.ts start-now` then reopen app
- **Gathering header**: shows “GATHERING” + countdown chip + rules chip
- **Gathering end**: run `pnpm exec tsx scripts/dev/worldctl.ts end-now` and confirm app exits Gathering

## Feed + Credibility signals
- **Generation ring**: visible on avatars across Home/Search/Thread/Profile
- **Generation explainer**: tap avatar ring opens explanation sheet
- **Status badge**: visible next to handle; color changes by SCS band
- **Badge explainer**: tap badge opens SCS breakdown sheet (tiers visible)

## Compose + Media
- **Compose open**: FAB opens compose modal in Tribal + Gathering
- **Gathering FAB**: urgent color in Gathering
- **Media**: attach 1–4 images, preview, remove, post
- **Error state**: kill backend → verify calm errors for submit/upload

## Thread
- **Sticky composer**: always visible; keyboard-safe; no overlap
- **Low-signal replies**: short replies are visually muted
- **Gathering dissolved**: try sending reply after end; see calm dissolved state

## Inbox
- **Notifications**: list loads, no redundant headings
- **Messages**: filters work; requests accept/decline flows work

## Lists
- **Create list**: create; edit; remove items; list timeline loads


