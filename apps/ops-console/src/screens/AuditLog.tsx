import React, { useEffect, useState } from 'react';
import { opsClient } from '../api/opsClient';

export function AuditLog() {
  const [entries, setEntries] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (next?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await opsClient.audit();
      setEntries(res.entries ?? []);
      setCursor(null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(null);
  }, []);

  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">Audit Log</h1>
        <div className="flex gap-2">
          <button className="px-3 py-2 bg-gray-100 rounded" onClick={() => load(null)} disabled={loading}>
            Refresh
          </button>
          <button className="px-3 py-2 bg-gray-100 rounded" onClick={() => load(cursor)} disabled={loading || !cursor}>
            Next
          </button>
        </div>
      </div>
      {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
      {loading ? <div>Loading…</div> : null}
      {entries.length === 0 ? <div className="text-sm text-gray-500">No audit entries.</div> : null}
      <ul className="space-y-2">
        {entries.map((e, idx) => (
          <li key={e.id ?? idx} className="border rounded p-3">
            <div className="flex justify-between text-sm text-gray-500">
              <span>{e.occurred_at ?? 'time'}</span>
              <span>{e.ops_user ?? 'actor'}</span>
            </div>
            <div className="font-semibold">{e.action ?? 'action'}</div>
            <div className="text-sm text-gray-500">
              {e.target_type ? `${e.target_type}:${e.target_id}` : '—'} · role={e.ops_role ?? '—'} · cid={e.correlation_id ?? '—'}
            </div>
            {e.reason ? <div className="text-sm whitespace-pre-wrap mt-1">Reason: {e.reason}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

