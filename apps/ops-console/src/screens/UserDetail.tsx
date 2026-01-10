import React, { useEffect, useState } from 'react';
import { opsClient } from '../api/opsClient';

type Props = { id: string };

export function UserDetail({ id }: Props) {
  const [data, setData] = useState<any>(null);
  const [action, setAction] = useState('restrict');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await opsClient.userDetail(id);
      setData(res);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await opsClient.userAction(id, action, reason, notes);
      setSuccess('Action applied');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to apply action');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading && !data) return <div className="p-4">Loading…</div>;
  if (error && !data) return <div className="p-4 text-red-600">{error}</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">User</h1>
        <button className="px-3 py-2 bg-gray-100 rounded" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
      {success ? <div className="bg-green-50 text-green-700 p-2 rounded">{success}</div> : null}
      <div className="border p-3 rounded space-y-2">
        <div className="font-semibold">{data?.user?.display_name ?? data?.user?.handle ?? data?.user?.id ?? id}</div>
        <div className="text-sm text-gray-500">@{data?.user?.handle ?? 'unknown'}</div>
        <div className="text-sm text-gray-500">
          Generation: {data?.user?.generation ?? 'n/a'} · Verified: {String(Boolean(data?.user?.is_verified))}
        </div>
        <div className="text-sm text-gray-500">Created: {data?.user?.created_at ?? 'n/a'}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="border p-3 rounded space-y-2">
          <div className="font-semibold">Active safety</div>
          <div className="text-sm text-gray-600">Restrictions: {Array.isArray(data?.safety?.restrictions) ? data.safety.restrictions.length : 0}</div>
          <div className="text-sm text-gray-600">Frictions: {Array.isArray(data?.safety?.frictions) ? data.safety.frictions.length : 0}</div>
          <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">{JSON.stringify(data?.safety ?? {}, null, 2)}</pre>
        </div>
        <div className="border p-3 rounded space-y-2">
          <div className="font-semibold">Sessions</div>
          <div className="text-sm text-gray-600">{Array.isArray(data?.sessions) ? `${data.sessions.length} sessions` : 'n/a'}</div>
          <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">{JSON.stringify(data?.sessions ?? [], null, 2)}</pre>
        </div>
      </div>

      <div className="border p-3 rounded space-y-2">
        <div className="font-semibold">Recent entries</div>
        <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">{JSON.stringify(data?.recent?.entries ?? [], null, 2)}</pre>
      </div>
      <div className="border p-3 rounded space-y-3">
        <h2 className="font-semibold">Action</h2>
        <div className="text-xs text-gray-500">
          Actions are stubbed until moderation write endpoints are wired into ops-gateway.
        </div>
        <select className="border p-2 rounded w-full" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="restrict">Restrict</option>
          <option value="block">Block</option>
          <option value="warn">Warn</option>
          <option value="lift">Lift restrictions</option>
        </select>
        <div>
          <label className="block text-sm">Reason</label>
          <input className="w-full border p-2 rounded" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm">Notes (optional)</label>
          <textarea className="w-full border p-2 rounded" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-2 bg-blue-600 text-white rounded" onClick={apply} disabled={loading}>
            Apply
          </button>
          <button className="px-3 py-2 bg-gray-100 rounded" onClick={load} disabled={loading}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

