"use client";
import React, { useEffect, useState } from 'react';
import { RbacGuard } from '../../../components/RbacGuard';
import { Role } from '@platform/security';
import { opsClient } from '../../../src/api/opsClient';

export default function SafetyFlagsPage() {
  const [friction, setFriction] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await opsClient.safetyFriction();
      setFriction(res?.friction ?? []);
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
    <RbacGuard allowed={[Role.SafetyOps, Role.IntegrityOps]}>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Safety Flags & Friction</h2>
        {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
        {loading ? <div className="text-sm text-gray-500">Loading…</div> : null}
        <div className="rounded border bg-white p-3 text-xs space-y-2">
          <h3 className="font-semibold">Active Friction</h3>
          {friction.map((f) => (
            <div key={f.id} className="border-b pb-2">
              <div>
                Target: {f.target_type} {f.target_id}
              </div>
              <div>Type: {f.friction_type}</div>
              <div>Expires: {f.expires_at}</div>
            </div>
          ))}
          {friction.length === 0 && <div className="text-slate-500">No active friction</div>}
        </div>
      </section>
    </RbacGuard>
  );
}

