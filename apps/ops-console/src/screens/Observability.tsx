import React, { useEffect, useState } from 'react';
import { opsClient } from '../api/opsClient';

export function Observability() {
  const [health, setHealth] = useState<any>(null);
  const [inbox, setInbox] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const h = await opsClient.healthSummary();
      const e = await opsClient.errorInbox();
      setHealth(h);
      setInbox((e as any)?.items ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = inbox.filter((it) => {
    const q = String(filter ?? '').trim().toLowerCase();
    if (!q) return true;
    const hay = `${it?.service ?? ''} ${it?.route ?? ''} ${it?.message ?? ''} ${it?.fingerprint ?? ''}`.toLowerCase();
    return hay.includes(q);
  });

  const createTaskFromError = async (it: any) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const svc = String(it?.service ?? 'unknown');
      const _route = String(it?.route ?? 'unknown');
      const status = it?.status ? ` ${it.status}` : '';
      const msg = String(it?.message ?? 'error').slice(0, 140);
      await opsClient.agentCreateTask({
        type: 'reliability_triage',
        summary: `Investigate ${svc}${status}: ${msg}`,
        evidence: {
          source: 'ops_error_inbox',
          fingerprint: it?.fingerprint ?? null,
          service: it?.service ?? null,
          route: it?.route ?? null,
          status: it?.status ?? null,
          sample_correlation_id: it?.sample_correlation_id ?? null,
          count: it?.count ?? null,
          first_seen_at: it?.first_seen_at ?? null,
          last_seen_at: it?.last_seen_at ?? null,
          meta: it?.meta ?? null,
        },
      });
      setSuccess('Agent task created');
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">Observability</h1>
        <button className="px-3 py-2 bg-gray-100 rounded" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
      {success ? <div className="bg-green-50 text-green-700 p-2 rounded">{success}</div> : null}
      <div className="border rounded p-3 bg-white">
        <div className="font-semibold mb-2">Service health (readyz)</div>
        <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">{JSON.stringify(health, null, 2)}</pre>
      </div>
      <div className="border rounded p-3 bg-white">
        <div className="flex items-center justify-between mb-2">
          <div className="font-semibold">Error inbox</div>
          <input
            className="border p-2 rounded text-sm w-64"
            placeholder="Filter (service/route/message)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {filtered.length === 0 ? <div className="text-sm text-gray-500">No items.</div> : null}
        <div className="space-y-2">
          {filtered.map((it) => (
            <div key={it.fingerprint} className="border rounded p-3">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="font-semibold text-sm">
                    {it.service ?? 'unknown'} {it.status ? `(${it.status})` : ''}{' '}
                    <span className="text-gray-600">{it.route ?? ''}</span>
                  </div>
                  <div className="text-xs text-gray-600">{it.message ?? ''}</div>
                  <div className="text-xs text-gray-500">
                    count={it.count ?? 0} · last={it.last_seen_at ?? '—'} · cid={it.sample_correlation_id ?? '—'}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    className="px-3 py-2 bg-blue-600 text-white rounded text-sm"
                    onClick={() => createTaskFromError(it)}
                    disabled={loading}
                  >
                    Create triage task
                  </button>
                </div>
              </div>
              <details className="mt-2">
                <summary className="text-xs text-gray-600 cursor-pointer">Raw</summary>
                <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto mt-2">{JSON.stringify(it, null, 2)}</pre>
              </details>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


