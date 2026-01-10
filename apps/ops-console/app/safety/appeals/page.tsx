"use client";
import React, { useEffect, useState } from 'react';
import { RbacGuard } from '../../../components/RbacGuard';
import { Role } from '@platform/security';
import { opsClient } from '../../../src/api/opsClient';

export default function SafetyAppealsPage() {
  const [appeals, setAppeals] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolveReason, setResolveReason] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await opsClient.safetyAppeals();
      setAppeals(res?.appeals ?? []);
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
    <RbacGuard allowed={[Role.SafetyOps, Role.SupportOps]}>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold">Appeals</h2>
        {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
        {loading ? <div className="text-sm text-gray-500">Loading…</div> : null}
        <div className="rounded border bg-white p-3 text-xs space-y-2">
          <div className="font-semibold">Resolve reason (required)</div>
          <input
            className="w-full border p-2 rounded text-sm"
            placeholder="Why are you resolving this appeal?"
            value={resolveReason}
            onChange={(e) => setResolveReason(e.currentTarget.value)}
          />
        </div>
        <div className="rounded border bg-white p-3 text-xs space-y-2">
          {appeals.map((a) => (
            <div key={a.id} className="border-b pb-2">
              <div>
                Target: {a.target_type} {a.target_id}
              </div>
              <div>Status: {a.status}</div>
              <div>Reason: {a.reason}</div>
              <div>Resolution: {a.resolution || 'pending'}</div>
              {a.status !== 'resolved' ? (
                <div className="flex gap-2 mt-2">
                  <button
                    className="px-2 py-1 rounded bg-gray-100"
                    disabled={!resolveReason.trim() || loading}
                    onClick={async () => {
                      try {
                        setLoading(true);
                        await opsClient.safetyResolveAppeal(a.id, 'upheld', resolveReason.trim());
                        await load();
                      } catch (e: any) {
                        setError(e?.message ?? 'Resolve failed');
                      } finally {
                        setLoading(false);
                      }
                    }}
                  >
                    Uphold
                  </button>
                  <button
                    className="px-2 py-1 rounded bg-gray-100"
                    disabled={!resolveReason.trim() || loading}
                    onClick={async () => {
                      try {
                        setLoading(true);
                        await opsClient.safetyResolveAppeal(a.id, 'overturned', resolveReason.trim());
                        await load();
                      } catch (e: any) {
                        setError(e?.message ?? 'Resolve failed');
                      } finally {
                        setLoading(false);
                      }
                    }}
                  >
                    Overturn
                  </button>
                </div>
              ) : null}
            </div>
          ))}
          {appeals.length === 0 && <div className="text-slate-500">No appeals</div>}
        </div>
      </section>
    </RbacGuard>
  );
}

