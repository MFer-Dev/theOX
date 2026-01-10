import React, { useEffect, useState } from 'react';
import { opsClient } from '../api/opsClient';

export function AdminDashboard() {
  const [health, setHealth] = useState<any>(null);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const h = await opsClient.healthSummary();
      const inc = await opsClient.incidentsRecent();
      setHealth(h);
      setIncidents(inc ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <button className="px-3 py-2 bg-gray-100 rounded" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
      {loading ? <div>Loading…</div> : null}
      <div className="grid grid-cols-3 gap-3">
        <div className="border p-3 rounded">
          <div className="text-sm text-gray-500">API</div>
          <div className="text-lg">{health?.api ?? 'n/a'}</div>
        </div>
        <div className="border p-3 rounded">
          <div className="text-sm text-gray-500">Latency p95</div>
          <div className="text-lg">{health?.latency ?? 'n/a'}</div>
        </div>
        <div className="border p-3 rounded">
          <div className="text-sm text-gray-500">Queues</div>
          <div className="text-lg">{health?.queues ?? 'n/a'}</div>
        </div>
      </div>
      <div className="border p-3 rounded">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-semibold">Incidents</h2>
        </div>
        {incidents.length === 0 ? (
          <div className="text-sm text-gray-500">No recent incidents</div>
        ) : (
          <ul className="space-y-2">
            {incidents.map((i) => (
              <li key={i.id} className="border p-2 rounded">
                {i.summary}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Moderation', href: '/ops/moderation' },
          { label: 'Users', href: '/ops/users' },
          { label: 'Audit', href: '/ops/audit' },
          { label: 'Config', href: '/ops/config' },
          { label: 'Observability', href: '/ops/observability' },
          { label: 'Agents', href: '/ops/agents' },
          { label: 'Purge', href: '/ops/purge' },
          { label: 'Integrity', href: '/ops/integrity' },
          { label: 'Cred Ledger', href: '/ops/cred/ledger' },
        ].map((t) => (
          <a key={t.href} href={t.href} className="border p-4 rounded hover:bg-gray-50 block">
            <div className="font-semibold">{t.label}</div>
            <div className="text-sm text-gray-500">Open {t.label}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

