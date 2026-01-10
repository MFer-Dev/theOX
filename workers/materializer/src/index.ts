import { getPool } from '@platform/shared';
import { runConsumer, EventEnvelope } from '@platform/events';
import Fastify from 'fastify';

const pool = getPool('discourse');

type DiscoursePayload = {
  entry_id?: string;
  reply_id?: string;
  generation: string;
  author_id: string;
  assumption_type?: string;
  body?: string;
};

type EndorsePayload = {
  endorsement_id: string;
  entry_id: string;
};

const upsertTimeline = async (payload: DiscoursePayload, isReply: boolean) => {
  if (!payload.entry_id) return;
  if (!isReply) {
    await pool.query(
      `insert into timeline_items (entry_id, generation, author_id, topic, assumption_type, body_preview, created_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (entry_id) do nothing`,
      [
        payload.entry_id,
        payload.generation,
        payload.author_id,
        (payload as any).topic || null,
        payload.assumption_type,
        (payload.body || '').slice(0, 140),
      ],
    );
  } else {
    await pool.query('update timeline_items set reply_count = reply_count + 1 where entry_id=$1', [payload.entry_id]);
  }
};

const applyEndorse = async (payload: EndorsePayload) => {
  await pool.query('update timeline_items set endorse_count = endorse_count + 1 where entry_id=$1', [payload.entry_id]);
};

const handler = async (evt: EventEnvelope<any>) => {
  if (evt.event_type === 'discourse.entry_created') {
    await upsertTimeline(evt.payload as DiscoursePayload, false);
  }
  if (evt.event_type === 'discourse.reply_created') {
    await upsertTimeline(evt.payload as DiscoursePayload, true);
  }
  if (evt.event_type === 'endorse.created') {
    await applyEndorse(evt.payload as EndorsePayload);
  }
};

const start = async () => {
  await runConsumer({
    groupId: 'materializer',
    topics: ['events.discourse.v1', 'events.endorse.v1'],
    handler,
  });

  const app = Fastify({ logger: false });
  app.get('/status', async () => {
    const res = await pool.query('select max(created_at) as last_item from timeline_items');
    return { ok: true, last_item: res.rows[0]?.last_item ?? null };
  });
  await app.listen({ port: Number(process.env.MATERIALIZER_PORT || 4100), host: '0.0.0.0' });
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

