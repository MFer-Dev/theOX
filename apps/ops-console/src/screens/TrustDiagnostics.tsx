import React, { useEffect, useState } from 'react';
import { opsClient } from '../api/opsClient';

type Props = { userId: string };

export function TrustDiagnostics({ userId }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await opsClient.trustUser(userId);
      setData(res);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <div className="p-4 space-y-3">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">Trust Diagnostics</h1>
        <button className="px-3 py-2 bg-gray-100 rounded" onClick={load} disabled={loading}>
          Refresh
        </button>
      </div>
      <div className="text-sm text-gray-600">user={userId}</div>
      {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
      <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

