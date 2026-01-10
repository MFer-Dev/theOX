import React, { useEffect, useState } from 'react';
import { opsClient } from '../api/opsClient';

export function ModerationQueue() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await opsClient.moderationQueue();
      setItems((data as any)?.items ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load queue');
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
        <h1 className="text-xl font-semibold">Moderation Queue</h1>
        <button className="px-3 py-2 bg-gray-100 rounded" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
      {loading ? <div>Loading…</div> : null}
      {items.length === 0 ? <div className="text-sm text-gray-500">No items in queue.</div> : null}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="border rounded p-3 flex justify-between">
            <div>
              <div className="font-semibold">{item.title ?? 'Content'}</div>
              <div className="text-sm text-gray-500">{item.reason ?? 'report'}</div>
            </div>
            <a href={`/ops/moderation/${item.id}`} className="text-blue-600 text-sm">
              Open
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

