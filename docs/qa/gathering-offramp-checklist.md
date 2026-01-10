# Gathering off‑ramp QA checklist

## Preconditions
- You can schedule a Gathering window via Purge service.
- You can observe the world clock via Gateway:
  - `GET /world/clock`
  - `GET /world/stream` (SSE)

## Start/End timing
- **Start flip**
  - When `active` becomes `true`, the mobile UI switches to Gathering skin within ~1s.
  - The “enter” overlay appears once per `starts_at`.
- **End flip**
  - In the last ~5 minutes, the countdown banner appears.
  - In the last ~15 seconds, the full-screen dissolve blocks interaction.
  - At `ends_at`, the app exits Gathering immediately (no waiting for a poll).
  - The “collapse” overlay appears once per `ends_at`.

## Ephemeral behavior (“anything you’re doing is lost”)
- **Compose**
  - Open Compose near end, wait until after `ends_at`, press Submit.
  - Expect: `gathering_ended` and a calm “dissolved” sheet; draft cleared and returned.
- **Reply**
  - Open Thread, type reply, wait until after `ends_at`, press Reply.
  - Expect: `gathering_ended` and a calm “dissolved” message; draft discarded.
- **DM send**
  - Open DM thread, type message, wait until after `ends_at`, press Send.
  - Expect: `gathering_ended` and a calm “dissolved” sheet; returned.
- **Lists**
  - Try create/add/remove after `ends_at`.
  - Expect: `gathering_ended` and a calm “dissolved” sheet.

## Backend enforcement
- Verify these endpoints return **HTTP 410** with `{ error: "gathering_ended" }` when `x-trybl-world: gathering` and the window is over:
  - Discourse: create entry, reply, interactions, delete entry
  - Messaging: send, accept/decline request
  - Lists: create list, add/remove item


