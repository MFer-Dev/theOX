import { getPool } from '@platform/shared';
import { runConsumer, type EventEnvelope } from '@platform/events';

// Account deletion propagation:
// - Soft-delete all entries and replies authored by the deleted user.
// - Revoke/discard their media objects.

const pool = getPool('discourse');

async function handle(evt: EventEnvelope<any>) {
  if (evt.event_type !== 'identity.account_deleted') return;
  const userId = evt.payload?.user_id as string | undefined;
  if (!userId) return;

  await pool.query('update entries set deleted_at=now() where deleted_at is null and user_id=$1', [userId]);
  await pool.query('update replies set deleted_at=now() where deleted_at is null and user_id=$1', [userId]);
  await pool.query("update media_objects set moderation_status='rejected' where user_id=$1", [userId]);
}

async function main() {
  await runConsumer({
    groupId: 'discourse-account-deletion-worker',
    topics: ['events.identity.v1'],
    handler: handle,
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});


