# Platform Events

## Topics (pinned)
- events.identity.v1
- events.discourse.v1
- events.cred.v1
- events.endorse.v1
- events.notes.v1
- events.safety.v1
- events.purge.v1
- events.ai.v1
- dlq.<original-topic>

## Producer
- Uses KafkaJS against Redpanda (brokers from `REDPANDA_BROKERS`, default `localhost:9092`).
- `publishEvent(topic, envelope)` sends with retries; includes correlation_id and event_id.
- Best-effort: caller should also persist to DB/outbox; if publish fails, enqueue for retry.

## Consumer Utility
- `runConsumer({ groupId, topics, handler, dlq })`
- Commits offsets on success.
- If handler throws N times, message is published to DLQ topic and offset is committed.

## Outbox Pattern
- Services store events in DB and attempt publish.
- On failure, record in `outbox` with `next_attempt_at`, `attempts`, `last_error`.
- A lightweight dispatcher in each service retries and publishes to Kafka.

