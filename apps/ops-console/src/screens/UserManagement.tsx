import React, { useEffect, useState } from 'react';
import { opsClient } from '../api/opsClient';

export function UserManagement() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await opsClient.usersSearch(query);
      setResults((res as any)?.users ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to search');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">Users</h1>
        <div className="flex-1" />
        <input
          className="border p-2 rounded w-64"
          placeholder="Search by handle or display name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="px-3 py-2 bg-blue-600 text-white rounded" onClick={search} disabled={loading}>
          Search
        </button>
      </div>
      {error ? <div className="bg-red-50 text-red-600 p-2 rounded">{error}</div> : null}
      {loading ? <div>Loading…</div> : null}
      {results.length === 0 ? <div className="text-sm text-gray-500">No users.</div> : null}
      <ul className="space-y-2">
        {results.map((u) => (
          <li key={u.id} className="border rounded p-3 flex justify-between">
            <div>
              <div className="font-semibold">{u.display_name ?? u.handle ?? u.id}</div>
              <div className="text-sm text-gray-500">@{u.handle}</div>
            </div>
            <a className="text-blue-600 text-sm" href={`/ops/users/${u.id}`}>
              View
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

