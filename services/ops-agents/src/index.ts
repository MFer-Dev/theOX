import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ensureCorrelationId, getPool } from '@platform/shared';
import { buildEvent, publishEvent, runConsumer, type EventEnvelope } from '@platform/events';

const app = Fastify({ logger: true });
const pool = getPool('ops_agents');
const opsGatewayUrl = process.env.OPS_GATEWAY_URL ?? 'http://localhost:4013';
const opsInternalKey = process.env.OPS_INTERNAL_KEY ?? 'dev_internal';

const normalizeRouteForFingerprint = (route: string) => {
  const raw = String(route ?? '').split('?')[0];
  return raw
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
    .replace(/\/\d{2,}/g, '/:num')
    .slice(0, 160);
};

const reportOpsError = async (args: { correlationId: string; route: string; message: string }) => {
  const routeKey = normalizeRouteForFingerprint(args.route);
  const fp = `ops-agents:${routeKey}:${args.message}`.slice(0, 180);
  try {
    await fetch(`${opsGatewayUrl}/ops/observability/report-error`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-correlation-id': args.correlationId,
        'x-internal-call': 'true',
        'x-internal-key': opsInternalKey,
        'x-ops-user': 'ops-agents',
      },
      body: JSON.stringify({
        fingerprint: fp,
        service: 'ops-agents',
        route: routeKey,
        status: 500,
        message: args.message,
        meta: { source: 'ops_agents_error_handler', raw_route: args.route },
      }),
    });
  } catch {
    // ignore
  }
};

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.setErrorHandler(async (err, request, reply) => {
  try {
    const correlationId = String(request.headers['x-correlation-id'] ?? '');
    const msg = String((err as any)?.message ?? (err as any)?.code ?? 'unhandled_error').slice(0, 200);
    await reportOpsError({ correlationId, route: String(request.url), message: msg });
  } catch {
    // ignore
  }
  reply.status(500).send({ error: 'internal_error' });
});

app.register(swagger, { openapi: { info: { title: 'Ops Agents', version: '0.0.1' } } });
app.register(swaggerUi, { routePrefix: '/docs', uiConfig: { docExpansion: 'list' } });

app.get('/healthz', async () => ({ ok: true }));
app.get('/readyz', async () => ({ ready: true }));

app.get('/tasks', async () => {
  const rows = await pool.query('select * from ops_agent_tasks order by updated_at desc limit 200');
  return { tasks: rows.rows };
});

async function createTask(args: { type: string; summary: string; evidence?: any; proposed_actions?: any[]; correlationId?: string }) {
  const row = await pool.query(
    `insert into ops_agent_tasks (type, summary, evidence, proposed_actions, status)
     values ($1,$2,$3,$4,$5) returning *`,
    [
      args.type,
      args.summary.slice(0, 400),
      JSON.stringify(args.evidence ?? {}),
      JSON.stringify(args.proposed_actions ?? []),
      (args.proposed_actions?.length ?? 0) > 0 ? 'needs_approval' : 'queued',
    ],
  );
  const evt = buildEvent(
    'ops.agent_task.created',
    { task_id: row.rows[0].id, type: args.type, summary: args.summary },
    { actorId: 'system', correlationId: args.correlationId },
  );
  try {
    await publishEvent('events.ops_agents.v1', evt);
  } catch {
    // ignore for v0
  }
  return row.rows[0];
}

app.post('/tasks', async (request, reply) => {
  const body = (request.body ?? {}) as { type?: string; summary?: string; evidence?: any };
  const type = String(body.type ?? 'support_assist');
  const summary = String(body.summary ?? '').slice(0, 400);
  if (!summary) {
    reply.status(400);
    return { error: 'summary required' };
  }
  const task = await createTask({
    type,
    summary,
    evidence: body.evidence ?? {},
    correlationId: String(request.headers['x-correlation-id'] ?? ''),
  });
  return { task };
});

app.post('/tasks/:id/propose', async (request, reply) => {
  const id = String((request.params as any).id);
  const body = (request.body ?? {}) as { proposed_actions?: any[] };
  const actions = Array.isArray(body.proposed_actions) ? body.proposed_actions : [];
  const row = await pool.query(
    `update ops_agent_tasks
     set proposed_actions=$2, status='needs_approval', updated_at=now()
     where id=$1 returning *`,
    [id, JSON.stringify(actions)],
  );
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not_found' };
  }
  return { task: row.rows[0] };
});

app.post('/tasks/:id/approve', async (request, reply) => {
  const id = String((request.params as any).id);
  const body = (request.body ?? {}) as {
    ops_user?: string;
    ops_role?: string;
    decision?: string;
    reason?: string;
    patched_action?: any;
  };
  const decision = String(body.decision ?? 'approved');
  const reason = String(body.reason ?? '').slice(0, 280);
  if (!reason.trim()) {
    reply.status(400);
    return { error: 'reason required' };
  }
  const approval = await pool.query(
    `insert into ops_agent_approvals (task_id, ops_user, ops_role, decision, reason, patched_action)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [
      id,
      body.ops_user ?? 'local-dev',
      body.ops_role ?? 'core_ops',
      decision,
      reason,
      JSON.stringify(body.patched_action ?? null),
    ],
  );
  const row = await pool.query(
    `update ops_agent_tasks set status=$2, updated_at=now()
     where id=$1 returning *`,
    [id, decision === 'approved' ? 'executing' : 'queued'],
  );
  if (!row.rowCount) {
    reply.status(404);
    return { error: 'not_found' };
  }

  // If approved, execute proposed_actions through ops-gateway tool endpoints (internal auth).
  const results: any[] = [];
  if (decision === 'approved') {
    const task = row.rows[0];
    const patched = body.patched_action ?? null;
    const actions = patched ? [patched] : Array.isArray(task.proposed_actions) ? task.proposed_actions : [];
    for (const a of actions) {
      try {
        const tool = String(a?.tool ?? '');
        const args = a?.args ?? {};
        const url =
          tool === 'safety.apply_friction'
            ? `${opsGatewayUrl}/ops/tools/safety/apply-friction`
            : tool === 'safety.restrict_user'
              ? `${opsGatewayUrl}/ops/tools/safety/restrict-user`
              : tool === 'safety.revoke_friction'
                ? `${opsGatewayUrl}/ops/tools/safety/revoke-friction`
                : tool === 'safety.lift_restriction'
                  ? `${opsGatewayUrl}/ops/tools/safety/lift-restriction`
                  : tool === 'discourse.remove_entry'
                    ? `${opsGatewayUrl}/ops/tools/discourse/remove-entry`
                    : tool === 'discourse.restore_entry'
                      ? `${opsGatewayUrl}/ops/tools/discourse/restore-entry`
                      : null;
        if (!url) {
          results.push({ tool, ok: false, error: 'unknown_tool' });
          continue;
        }
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-correlation-id': String(request.headers['x-correlation-id'] ?? ''),
            'x-internal-call': 'true',
            'x-internal-key': opsInternalKey,
            'x-ops-user': body.ops_user ?? 'ops-agent',
          },
          body: JSON.stringify({ approval_id: approval.rows[0].id, ...args }),
        });
        const json = await res.json();
        results.push({ tool, ok: res.ok, status: res.status, result: json });
      } catch (e: any) {
        results.push({ tool: String(a?.tool ?? ''), ok: false, error: e?.message ?? 'tool_failed' });
      }
    }
    await pool.query(`update ops_agent_tasks set status='completed', execution_results=$2, updated_at=now() where id=$1`, [
      id,
      JSON.stringify(results),
    ]);
  } else {
    await pool.query(`update ops_agent_tasks set status='queued', updated_at=now() where id=$1`, [id]);
  }

  const updated = await pool.query('select * from ops_agent_tasks where id=$1', [id]);
  return { task: updated.rows[0], decision, approval: approval.rows[0] };
});

// --- Event-driven ingestion: subscribe to platform events and create tasks ---
async function handleEvent(evt: EventEnvelope<any>) {
  const correlationId = evt.correlation_id ?? undefined;
  if (evt.event_type === 'safety.report_created') {
    const reportId = evt.payload?.report_id;
    const targetType = String(evt.payload?.target_type ?? 'content');
    const targetId = String(evt.payload?.target_id ?? '');
    const reason = String(evt.payload?.reason ?? 'report').slice(0, 120);
    if (!reportId || !targetId) return;
    // Proposed action: apply friction to the reported target (requires approval; executed via tools).
    const proposed = [
      {
        tool: 'safety.apply_friction',
        args: {
          target_type: targetType,
          target_id: targetId,
          friction_type: 'reply_cooldown',
          expires_in_sec: 1800,
          reason: `auto_suggest:${reason}`,
        },
      },
    ];
    await createTask({
      type: 'safety_triage',
      summary: `New safety report (${reason})`,
      evidence: { event_type: evt.event_type, report_id: reportId, target_type: targetType, target_id: targetId, reason },
      proposed_actions: proposed,
      correlationId,
    });
    return;
  }
  if (evt.event_type === 'ops.error_raised') {
    const fp = String(evt.payload?.fingerprint ?? '').slice(0, 200);
    const svc = evt.payload?.service ?? null;
    const route = evt.payload?.route ?? null;
    const msg = String(evt.payload?.message ?? 'error').slice(0, 160);
    if (!fp) return;
    await createTask({
      type: 'reliability_triage',
      summary: `Service error: ${msg}`,
      evidence: { event_type: evt.event_type, fingerprint: fp, service: svc, route, payload: evt.payload },
      correlationId,
    });
    return;
  }
  if (evt.event_type === 'purge.admin_scheduled' || evt.event_type === 'purge.admin_start') {
    await createTask({
      type: 'growth_ops',
      summary: `Gathering window event: ${evt.event_type}`,
      evidence: { event_type: evt.event_type, payload: evt.payload },
      correlationId,
    });
  }
}

async function startConsumer() {
  if (String(process.env.OPS_AGENTS_CONSUME_EVENTS ?? 'true') !== 'true') return;
  runConsumer({
    groupId: 'ops-agents',
    topics: ['events.safety.v1', 'events.purge.v1', 'events.discourse.v1', 'events.identity.v1', 'events.ops_agents.v1'],
    handler: handleEvent,
  }).catch((err) => {
    // Don't crash the API if Kafka is down; log and keep serving UI calls.
    // eslint-disable-next-line no-console
    console.error('ops-agents consumer failed', err);
  });
}

const start = async () => {
  const port = Number(process.env.PORT ?? 4014);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`ops-agents running on ${port}`);
  await startConsumer();
};

start().catch((err) => {
  app.log.error(err, 'failed to start ops-agents');
  process.exit(1);
});


