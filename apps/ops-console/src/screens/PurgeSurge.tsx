import React, { useEffect, useState } from 'react';
import { opsClient } from '../api/opsClient';

export function PurgeSurge() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await opsClient.purgeSurgeRecommendations();
      setItems(res?.recommendations ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">Purge Surge</h1>
        <button className="px-3 py-2 bg-gray-100 rounded" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
      {items.length === 0 ? <div className="text-sm text-gray-500">No recommendations.</div> : null}
      <div className="space-y-2">
        {items.map((r) => (
          <div key={String(r.id)} className="border rounded p-3 bg-white">
            <div className="text-sm font-semibold">risk={String(r.risk_level ?? 'unknown')}</div>
            <div className="text-xs text-gray-500">window={String(r.window_id ?? '—')} · at={String(r.created_at ?? '')}</div>
            <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto mt-2">{JSON.stringify(r.recommended_actions ?? {}, null, 2)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

