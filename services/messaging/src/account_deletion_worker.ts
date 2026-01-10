import { getPool } from '@platform/shared';
import { runConsumer, type EventEnvelope } from '@platform/events';

// Account deletion propagation (GDPR/App Store expectation):
// - When identity marks an account deleted, we soft-delete messaging threads/messages.
// - This prevents deleted users from showing up in inbox lists.

const pool = getPool('messaging');

async function handle(evt: EventEnvelope<any>) {
  if (evt.event_type !== 'identity.account_deleted') return;
  const userId = evt.payload?.user_id as string | undefined;
  if (!userId) return;
  await pool.query('update dm_threads set deleted_at=now(), updated_at=now() where deleted_at is null and (user_a=$1 or user_b=$1)', [
    userId,
  ]);
  await pool.query('update dm_messages set deleted_at=now() where deleted_at is null and from_user_id=$1', [userId]);
}

async function main() {
  await runConsumer({
    groupId: 'messaging-account-deletion-worker',
    topics: ['events.identity.v1'],
    handler: handle,
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


