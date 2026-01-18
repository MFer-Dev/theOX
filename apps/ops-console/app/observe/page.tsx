'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

/**
 * Chronicle Entry - what the viewer sees
 */
interface ChronicleEntry {
  ts: string;
  text: string;
}

/**
 * Format timestamp for display - relative time like "2m ago"
 */
function formatRelativeTime(ts: string): string {
  const now = Date.now();
  const then = new Date(ts).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * The First Seat - Observer Chronicle View
 *
 * A vertically scrolling, chronological stream of chronicle entries.
 * No buttons. No reactions. No composition.
 * This is spectatorship.
 */
export default function ObservePage() {
  const [entries, setEntries] = useState<ChronicleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch chronicle entries
  const fetchChronicle = useCallback(async () => {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_OX_READ_URL || 'http://localhost:4018';
      const res = await fetch(`${baseUrl}/ox/chronicle?window=120&limit=30`);

      if (!res.ok) {
        throw new Error(`Failed to fetch chronicle: ${res.status}`);
      }

      const data = await res.json();
      setEntries(data);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch and auto-refresh
  useEffect(() => {
    fetchChronicle();

    // Auto-refresh every 5 seconds
    const interval = setInterval(fetchChronicle, 5000);

    return () => clearInterval(interval);
  }, [fetchChronicle]);

  // Empty state - nothing happening
  if (!loading && entries.length === 0 && !error) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 flex flex-col items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <div className="text-6xl opacity-20">◯</div>
          <h1 className="text-xl font-light text-slate-400">Silence</h1>
          <p className="text-sm text-slate-500">
            Nothing is happening right now.
          </p>
          <p className="text-xs text-slate-600">
            Watching...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-300">
      {/* Header - minimal */}
      <header className="fixed top-0 left-0 right-0 z-10 bg-slate-950/90 backdrop-blur border-b border-slate-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-medium text-slate-400">Observing</span>
          </div>
          <span className="text-xs text-slate-600">
            {formatRelativeTime(lastRefresh.toISOString())}
          </span>
        </div>
      </header>

      {/* Main content - chronicle stream */}
      <main ref={containerRef} className="pt-16 pb-8">
        <div className="max-w-2xl mx-auto px-4">
          {/* Loading state */}
          {loading && entries.length === 0 && (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin w-6 h-6 border-2 border-slate-600 border-t-slate-400 rounded-full" />
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="py-8 text-center">
              <p className="text-sm text-red-400/70">{error}</p>
              <p className="text-xs text-slate-600 mt-2">Retrying...</p>
            </div>
          )}

          {/* Chronicle entries */}
          <div className="space-y-1">
            {entries.map((entry, index) => (
              <ChronicleEntryRow
                key={`${entry.ts}-${index}`}
                entry={entry}
                isFirst={index === 0}
              />
            ))}
          </div>

          {/* Infinite scroll hint */}
          {entries.length > 0 && (
            <div className="py-8 text-center">
              <p className="text-xs text-slate-700">
                Earlier events fade into history
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * Single chronicle entry row
 */
function ChronicleEntryRow({
  entry,
  isFirst,
}: {
  entry: ChronicleEntry;
  isFirst: boolean;
}) {
  return (
    <div
      className={`
        py-4 border-b border-slate-800/50
        transition-opacity duration-500
        ${isFirst ? 'opacity-100' : 'opacity-80'}
      `}
    >
      {/* Timestamp */}
      <div className="text-xs text-slate-600 mb-1">
        {formatRelativeTime(entry.ts)}
      </div>

      {/* The sentence - the heart of the chronicle */}
      <p className={`
        text-base leading-relaxed
        ${isFirst ? 'text-slate-200' : 'text-slate-400'}
      `}>
        {entry.text}
      </p>
    </div>
  );
}
