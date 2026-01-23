import { v4 as uuidv4 } from 'uuid';
import { GenerationCohort } from '@platform/shared';
import { Kafka, logLevel, Producer, Consumer } from 'kafkajs';
import { Pool } from 'pg';

// Re-export audio event contracts
export * from './audio';

export type EventEnvelope<TPayload = unknown> = {
  event_id: string;
  event_type: string;
  version: string;
  occurred_at: string;
  actor_id: string;
  actor_generation?: GenerationCohort;
  correlation_id?: string;
  context?: Record<string, unknown>;
  payload: TPayload;
};

export const buildEvent = <T>(
  eventType: string,
  payload: T,
  options: {
    actorId: string;
    actorGeneration?: GenerationCohort;
    version?: string;
    correlationId?: string;
    context?: Record<string, unknown>;
  },
): EventEnvelope<T> => ({
  event_id: uuidv4(),
  event_type: eventType,
  version: options.version ?? 'v1',
  occurred_at: new Date().toISOString(),
  actor_id: options.actorId,
  actor_generation: options.actorGeneration,
  correlation_id: options.correlationId,
  context: options.context,
  payload,
});

export type EventSchema = {
  $id: string;
  $schema: string;
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
};

export const envelopeSchema: EventSchema = {
  $id: 'platform.events.envelope',
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    event_id: { type: 'string', format: 'uuid' },
    event_type: { type: 'string' },
    version: { type: 'string' },
    occurred_at: { type: 'string', format: 'date-time' },
    actor_id: { type: 'string' },
    actor_generation: { type: 'string' },
    correlation_id: { type: 'string' },
    context: { type: 'object', additionalProperties: true },
    payload: { type: 'object' },
  },
  required: ['event_id', 'event_type', 'version', 'occurred_at', 'actor_id', 'payload'],
  additionalProperties: false,
};

export const versioning = {
  current: 'v1',
  notes: 'Increment when payload shape or semantics change; keep envelope stable.',
};

export const publishEvent = async <T>(topic: string, event: EventEnvelope<T>): Promise<void> => {
  const brokers = (process.env.REDPANDA_BROKERS || 'localhost:9092').split(',');
  const kafka = new Kafka({
    clientId: 'platform-events-producer',
    brokers,
    logLevel: logLevel.NOTHING,
  });
  const producer: Producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();
  try {
    await producer.send({
      topic,
      messages: [
        {
          key: event.event_id,
          value: JSON.stringify(event),
          headers: { 'x-correlation-id': event.correlation_id || '' },
        },
      ],
    });
  } finally {
    await producer.disconnect();
  }
};

export const persistEvent = async <T>(
  pool: Pool,
  event: EventEnvelope<T>,
  options?: { idempotencyKey?: string; reasonCodes?: string[]; context?: Record<string, unknown> },
): Promise<void> => {
  await pool.query(
    `insert into events (
      event_id, event_type, occurred_at, actor_id, actor_generation, correlation_id,
      idempotency_key, context, payload, reason_codes, reviewed_by, confidence
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      event.event_id,
      event.event_type,
      event.occurred_at,
      event.actor_id,
      event.actor_generation,
      event.correlation_id,
      options?.idempotencyKey ?? null,
      JSON.stringify(options?.context ?? {}),
      JSON.stringify(event.payload),
      options?.reasonCodes ? JSON.stringify(options.reasonCodes) : null,
      'system',
      'medium',
    ],
  );
};

export type ConsumerMeta = { topic: string; partition: number; offset: string; timestamp?: string };
export type ConsumerHandler = (event: EventEnvelope<any>, meta?: ConsumerMeta) => Promise<void>;

export const runConsumer = async ({
  groupId,
  topics,
  handler,
  dlq = true,
}: {
  groupId: string;
  topics: string[];
  handler: ConsumerHandler;
  dlq?: boolean;
}) => {
  const brokers = (process.env.REDPANDA_BROKERS || 'localhost:9092').split(',');
  const kafka = new Kafka({ clientId: 'platform-events-consumer', brokers, logLevel: logLevel.NOTHING });
  const consumer: Consumer = kafka.consumer({ groupId });
  await consumer.connect();
  for (const t of topics) {
    await consumer.subscribe({ topic: t, fromBeginning: true });
  }
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      const value = message.value?.toString();
      if (!value) return;
      const envelope = JSON.parse(value) as EventEnvelope<any>;
      let attempts = 0;
      const maxAttempts = 3;
      const meta: ConsumerMeta = {
        topic,
        partition,
        offset: message.offset,
        timestamp: message.timestamp,
      };
      while (attempts < maxAttempts) {
        try {
          await handler(envelope, meta);
          return;
        } catch {
          attempts += 1;
          if (attempts >= maxAttempts && dlq) {
            const dlqTopic = `dlq.${topic}`;
            const producer = kafka.producer();
            await producer.connect();
            await producer.send({
              topic: dlqTopic,
              messages: [{ key: envelope.event_id, value: value }],
            });
            await producer.disconnect();
            return;
          }
        }
      }
    },
  });
  return consumer;
};

