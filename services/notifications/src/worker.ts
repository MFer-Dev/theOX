import { getPool } from '@platform/shared';
import { runConsumer, type EventEnvelope } from '@platform/events';
import { createApnsStubProvider } from './push/providers/apns_stub';
import { createFcmStubProvider } from './push/providers/fcm_stub';

// Push worker:
// - consumes domain events and enqueues "push jobs"
// - attempts delivery via provider stubs (real providers can be swapped in later)

const pool = getPool('notifications');

const providerFor = (platform: string) => (platform === 'ios' ? createApnsStubProvider() : createFcmStubProvider());

async function enqueue(evt: EventEnvelope) {
  await pool.query('insert into push_jobs (event_type, payload, status) values ($1,$2,$3)', [
    evt.event_type,
    evt.payload ?? null,
    'queued',
  ]);
}

async function processQueueOnce(limit = 25) {
  const jobs = await pool.query(
    `select id, event_type, payload
     from push_jobs
     where status='queued'
     order by created_at asc
     limit $1`,
    [limit],
  );
  for (const j of jobs.rows) {
    // Extremely simple routing: pick all active device tokens and attempt stub send.
    const devices = await pool.query(
      `select platform, token
       from push_devices
       where revoked_at is null
       order by updated_at desc
       limit 200`,
    );
    let delivered = 0;
    for (const d of devices.rows) {
      const provider = providerFor(String(d.platform));
      try {
        await provider.send(
          { platform: d.platform, token: d.token },
          {
            title: 'Trybl',
            body: `Event: ${String(j.event_type)}`,
            data: { event_type: String(j.event_type) },
          },
        );
        delivered += 1;
      } catch {
        // still a stub; ignore
      }
    }
    await pool.query('update push_jobs set status=$2 where id=$1', [j.id, delivered ? 'sent' : 'skipped']);
  }
}

async function handler(evt: EventEnvelope) {
  // Account deletion propagation: revoke all device tokens immediately.
  if (evt.event_type === 'identity.account_deleted') {
    const userId = (evt as any).payload?.user_id as string | undefined;
    if (userId) {
      await pool.query('update push_devices set revoked_at=now(), updated_at=now() where user_id=$1 and revoked_at is null', [userId]);
    }
    return;
  }
  // For now, enqueue everything; downstream can filter by event_type.
  await enqueue(evt);
  // best-effort immediate processing (still safe as stub)
  await processQueueOnce(10);
}

async function main() {
  await runConsumer({
    groupId: 'notifications-worker',
    topics: ['events.discourse.v1', 'events.messaging.v1', 'events.purge.v1', 'events.safety.v1', 'events.identity.v1'],
    handler,
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


