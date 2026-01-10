import React, { useEffect, useState } from 'react';
import { opsClient } from '../api/opsClient';

type Props = { id: string };

export function ModerationDetail({ id }: Props) {
  const [data, setData] = useState<any>(null);
  const [decision, setDecision] = useState('remove');
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
      const res = await opsClient.moderationDetail(id);
      setData(res);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const act = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await opsClient.moderationAction(id, decision, reason, notes);
      setSuccess('Action recorded');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to apply action');
    } finally {
      setLoading(false);
    }
  };

  const requireReason = () => {
    const r = String(reason ?? '').trim();
    if (!r) {
      setError('Reason is required.');
      return null;
    }
    return r;
  };

  const liftRestrictions = async () => {
    const r = requireReason();
    if (!r) return;
    const userId = data?.author?.id ?? data?.content?.user_id ?? null;
    if (!userId) {
      setError('No user_id available on this case.');
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await opsClient.safetyLiftRestrictions(String(userId), r);
      setSuccess('Restrictions lifted');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to lift restrictions');
    } finally {
      setLoading(false);
    }
  };

  const revokeFriction = async (frictionId: string) => {
    const r = requireReason();
    if (!r) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await opsClient.safetyRevokeFriction(frictionId, r);
      setSuccess('Friction revoked');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to revoke friction');
    } finally {
      setLoading(false);
    }
  };

  const clearFriction = async (frictionId: string) => {
    const r = requireReason();
    if (!r) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await opsClient.safetyClearFriction(frictionId, r);
      setSuccess('Friction cleared');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to clear friction');
    } finally {
      setLoading(false);
    }
  };

  const liftRestriction = async (restrictionId: string) => {
    const r = requireReason();
    if (!r) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await opsClient.safetyLiftRestriction(restrictionId, r);
      setSuccess('Restriction lifted');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to lift restriction');
    } finally {
      setLoading(false);
    }
  };

  const restoreEntry = async (entryId: string) => {
    const r = requireReason();
    if (!r) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await opsClient.discourseRestoreEntry(entryId, r);
      setSuccess('Entry restored');
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to restore entry');
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
        <h1 className="text-xl font-semibold">Case {id}</h1>
        <button className="px-3 py-2 bg-gray-100 rounded" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
      {success ? <div className="bg-green-50 text-green-700 p-2 rounded">{success}</div> : null}
      <div className="border p-3 rounded">
        <h2 className="font-semibold mb-2">Content</h2>
        <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">
          {JSON.stringify(data?.content ?? null, null, 2)}
        </pre>
        {data?.content?.id && data?.content?.deleted_at ? (
          <div className="mt-2">
            <button
              className="px-3 py-2 bg-amber-600 text-white rounded"
              onClick={() => restoreEntry(String(data.content.id))}
              disabled={loading}
            >
              Restore content
            </button>
            <div className="text-xs text-gray-500 mt-1">Requires a reason; restores `deleted_at`.</div>
          </div>
        ) : null}
      </div>
      <div className="border p-3 rounded">
        <h2 className="font-semibold mb-2">Report history</h2>
        <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">
          {JSON.stringify(data?.report ?? null, null, 2)}
        </pre>
      </div>
      <div className="border p-3 rounded">
        <h2 className="font-semibold mb-2">User history</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-sm font-semibold">Author</div>
            <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">{JSON.stringify(data?.author ?? null, null, 2)}</pre>
          </div>
          <div>
            <div className="text-sm font-semibold">Integrity triage</div>
            <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">{JSON.stringify(data?.triage ?? null, null, 2)}</pre>
          </div>
        </div>
        <div className="mt-3">
          <div className="text-sm font-semibold">Current enforcement</div>
          <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">{JSON.stringify(data?.enforcement ?? null, null, 2)}</pre>
          <div className="flex gap-2 mt-2">
            <button className="px-3 py-2 bg-amber-600 text-white rounded" onClick={liftRestrictions} disabled={loading}>
              Lift restrictions (user)
            </button>
          </div>
          <div className="text-xs text-gray-500 mt-1">Requires a reason; expires all active restrictions for the user.</div>
        </div>
        {Array.isArray(data?.enforcement?.restrictions) && data.enforcement.restrictions.length ? (
          <div className="mt-3">
            <div className="text-sm font-semibold">Restriction actions</div>
            <div className="space-y-2">
              {data.enforcement.restrictions.map((r0: any) => (
                <div key={String(r0.id)} className="flex items-center justify-between rounded border bg-white p-2">
                  <div className="text-xs">
                    <div className="font-semibold">Restriction</div>
                    <div className="text-gray-600">
                      id: {String(r0.id).slice(0, 8)}… · expires: {String(r0.expires_at ?? '')}
                    </div>
                  </div>
                  <button
                    className="px-3 py-2 bg-amber-600 text-white rounded"
                    onClick={() => liftRestriction(String(r0.id))}
                    disabled={loading}
                  >
                    Lift
                  </button>
                </div>
              ))}
            </div>
            <div className="text-xs text-gray-500 mt-1">Lifts a single restriction (by id).</div>
          </div>
        ) : null}
        {Array.isArray(data?.enforcement?.frictions) && data.enforcement.frictions.length ? (
          <div className="mt-3">
            <div className="text-sm font-semibold">Friction actions</div>
            <div className="space-y-2">
              {data.enforcement.frictions.map((f: any) => (
                <div key={String(f.id)} className="flex items-center justify-between rounded border bg-white p-2">
                  <div className="text-xs">
                    <div className="font-semibold">{String(f.friction_type ?? 'friction')}</div>
                    <div className="text-gray-600">id: {String(f.id).slice(0, 8)}… · expires: {String(f.expires_at ?? '')}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="px-3 py-2 bg-amber-600 text-white rounded"
                      onClick={() => clearFriction(String(f.id))}
                      disabled={loading}
                    >
                      Clear
                    </button>
                    <button
                      className="px-3 py-2 bg-red-600 text-white rounded"
                      onClick={() => revokeFriction(String(f.id))}
                      disabled={loading}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Clear sets status to cleared; Revoke sets status to revoked. Both expire immediately.
            </div>
          </div>
        ) : null}
      </div>
      <div className="border p-3 rounded space-y-3">
        <h2 className="font-semibold">Decision</h2>
        <select className="border p-2 rounded w-full" value={decision} onChange={(e) => setDecision(e.target.value)}>
          <option value="remove">Remove</option>
          <option value="restrict">Restrict</option>
          <option value="warn">Warn</option>
          <option value="allow">Allow</option>
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
          <button className="px-3 py-2 bg-blue-600 text-white rounded" onClick={act} disabled={loading}>
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

