# Canonical Event Taxonomy (v1)

This document defines the **canonical, versioned event backbone** used for:
- auditing and recomputation
- semantic/IP derived products
- ranking explainability (“why you saw this”)
- observability + abuse analysis

## Envelope (required)
All events must be emitted as an `EventEnvelope` with:
- `event_id` (uuid)
- `event_type` (string, versioned by topic)
- `occurred_at` (timestamptz/ISO)
- `actor_id` (uuid or string “system”)
- `actor_generation` (optional)
- `correlation_id` (string)
- `payload` (json)

## Topic contracts (v1)
Topics are stable and versioned in the topic name:
- `events.identity.v1`
- `events.discourse.v1`
- `events.messaging.v1`
- `events.notifications.v1`
- `events.purge.v1`
- `events.safety.v1`
- `events.cred.v1`
- `events.endorse.v1`
- `events.notes.v1`

## Naming rules
- Use `domain.action` format: e.g. `discourse.entry_created`
- Do **not** rename shipped event types; add new types instead.
- Payload keys use `snake_case`.

## Core events (minimum set)

### Identity
- `identity.user_registered` `{ user_id, handle }`
- `identity.generation_verified` `{ user_id, generation }`
- `identity.account_deleted` `{ user_id, handle, deleted_at, reason? }`

### Discourse
- `discourse.entry_created` `{ entry_id, user_id, topic?, ai_assisted?, media_count? }`
- `discourse.reply_created` `{ reply_id, entry_id, user_id }`
- `discourse.entry_deleted` `{ entry_id, user_id }`

### Messaging
- `messaging.message_sent` `{ thread_id }`

### Purge (Gathering)
- `purge.admin_start` `{ starts_at, ends_at, minutes }`
- `purge.admin_scheduled` `{ starts_at, ends_at, minutes, starts_in_seconds }`
- `purge.reset` `{ reset: true }`

### Safety
- `safety.report_created` `{ report_id, target_type, target_id }`
- `safety.moderation_action` `{ moderation_id, target_type, action }`

### Notes
- `note.created` `{ note_id, content_id }`
- `note.updated` `{ note_id, version, status }`
- `note.cited` `{ note_id, citation_type }`

## Explainability (“why” codes)
Ranking surfaces may attach a small list of stable `why` codes (not events):
- `recent`
- `engagement`
- `affinity_topic`
- `credibility`
- `explore`

These codes must be treated as **user-facing contract** once shipped.


