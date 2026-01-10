import { getPool } from '@platform/shared';
import { runConsumer, EventEnvelope } from '@platform/events';

const safetyPool = getPool('safety');
const purgePool = getPool('purge');

type ReportPayload = {
  report_id: string;
  reason: string;
};

const upsertTriage = async (payload: ReportPayload) => {
  const severity = payload.reason?.toLowerCase().includes('abuse') ? 'high' : 'medium';
  const queue = severity === 'high' ? 'priority' : 'standard';
  await safetyPool.query(
    'insert into triage_suggestions (report_id, suggested_severity, suggested_queue, rationale) values ($1,$2,$3,$4) on conflict (report_id) do update set suggested_severity=$2, suggested_queue=$3, rationale=$4',
    [payload.report_id, severity, queue, `auto triage from reason: ${payload.reason}`],
  );
};

const upsertPurgeSurge = async (windowId: string | null, riskLevel: string) => {
  await purgePool.query(
    'insert into purge_surge_recommendations (window_id, risk_level, recommended_actions) values ($1,$2,$3)',
    [windowId, riskLevel, JSON.stringify({ apply_friction: riskLevel !== 'low' })],
  );
};

const handler = async (evt: EventEnvelope<any>) => {
  if (evt.event_type === 'safety.report_created') {
    await upsertTriage(evt.payload as ReportPayload);
  }
  if (evt.event_type === 'purge.window_scheduled') {
    await upsertPurgeSurge(evt.payload.window_id, 'low');
  }
};

const start = async () => {
  await runConsumer({
    groupId: 'integrity-workers',
    topics: ['events.safety.v1', 'events.purge.v1'],
    handler,
  });
};

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

