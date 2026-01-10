import React, { useEffect, useState } from 'react';
import { opsClient } from '../api/opsClient';

export function IntegrityTriageSuggestions() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await opsClient.integrityTriageSuggestions();
      setItems(res?.suggestions ?? []);
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
        <h1 className="text-xl font-semibold">Integrity Triage Suggestions</h1>
        <button className="px-3 py-2 bg-gray-100 rounded" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
      {items.length === 0 ? <div className="text-sm text-gray-500">No suggestions.</div> : null}
      <div className="space-y-2">
        {items.map((s) => (
          <div key={String(s.report_id ?? s.id)} className="border rounded p-3 bg-white">
            <div className="text-sm font-semibold">report={String(s.report_id ?? '—')}</div>
            <div className="text-xs text-gray-500">
              severity={String(s.suggested_severity ?? '—')} · queue={String(s.suggested_queue ?? '—')} · at={String(s.created_at ?? '')}
            </div>
            <div className="text-xs text-gray-700 mt-2 whitespace-pre-wrap">{String(s.rationale ?? '')}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

