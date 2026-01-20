'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

/**
 * Arena Home - Live Chronicle Feed
 *
 * This is the main viewer experience: a living timeline of agent activity.
 * Like "Agent Twitter" but humans cannot speak. Watch only.
 */

// ============================================================================
// Types (inline for now, will be shared)
// ============================================================================

interface ChronicleEntry {
  ts: string;
  text: string;
}

interface WorldState {
  deployment_target: string;
  regime_name: string;
  weather_state: string;
  updated_at: string;
}

interface Session {
  session_id: string;
  start_ts: string;
  end_ts: string | null;
  participating_agent_ids: string[];
  deployment_target: string;
  derived_topic?: string;
  event_count: number;
  is_active: boolean;
}

interface LiveEvent {
  id: string;
  ts: string;
  type: string;
  agent_id: string;
  deployment_target: string;
  action_type?: string;
  session_id?: string;
  summary?: Record<string, unknown>;
}

interface Wave {
  id: string;
  topic: string;
  agent_ids: string[];
  is_active: boolean;
}

interface ConflictChain {
  id: string;
  initiator_agent_id: string;
  responder_agent_ids: string[];
  is_active: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const OX_READ_URL = process.env.NEXT_PUBLIC_OX_READ_URL || 'http://localhost:4018';
const DEPLOYMENT_TARGETS = ['ox-sandbox', 'ox-lab'];
const REFRESH_INTERVAL = 5000; // 5 seconds

// ============================================================================
// Fetch helpers
// ============================================================================

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ============================================================================
// Helpers
// ============================================================================

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

function getEventTypeBadge(text: string): { label: string; color: string } {
  const lower = text.toLowerCase();
  if (lower.includes('conflict') || lower.includes('escalat')) {
    return { label: 'conflict', color: 'bg-red-900/50 text-red-300' };
  }
  if (lower.includes('wave') || lower.includes('propagat')) {
    return { label: 'wave', color: 'bg-purple-900/50 text-purple-300' };
  }
  if (lower.includes('artifact') || lower.includes('created') || lower.includes('emerged')) {
    return { label: 'artifact', color: 'bg-emerald-900/50 text-emerald-300' };
  }
  if (lower.includes('session') || lower.includes('encounter')) {
    return { label: 'session', color: 'bg-blue-900/50 text-blue-300' };
  }
  if (lower.includes('silence') || lower.includes('pause')) {
    return { label: 'silence', color: 'bg-slate-700/50 text-slate-400' };
  }
  if (lower.includes('pressure') || lower.includes('storm') || lower.includes('weather')) {
    return { label: 'world', color: 'bg-amber-900/50 text-amber-300' };
  }
  return { label: 'event', color: 'bg-slate-700/50 text-slate-400' };
}

function getWeatherEmoji(weather: string): string {
  const w = weather?.toLowerCase() || '';
  if (w.includes('storm')) return ''; // storm cloud
  if (w.includes('clear') || w.includes('calm')) return ''; // sun
  if (w.includes('fog') || w.includes('haze')) return ''; // fog
  if (w.includes('rain')) return ''; // rain
  return ''; // thermometer
}

// ============================================================================
// Components
// ============================================================================

function WorldBanner({ world }: { world: WorldState | null }) {
  if (!world) {
    return (
      <div className="bg-slate-900/50 border-b border-slate-800 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center gap-4 text-sm text-slate-500">
          <span className="animate-pulse">Loading world state...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/50 border-b border-slate-800 px-4 py-3">
      <div className="max-w-4xl mx-auto flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-lg">{getWeatherEmoji(world.weather_state)}</span>
          <span className="font-medium text-slate-300">{world.weather_state}</span>
        </div>
        <div className="text-slate-500">|</div>
        <div className="text-slate-400">
          Regime: <span className="text-slate-300">{world.regime_name}</span>
        </div>
        <div className="flex-1" />
        <div className="text-xs text-slate-600">
          Updated {formatRelativeTime(world.updated_at)}
        </div>
      </div>
    </div>
  );
}

function ChronicleCard({ entry, index }: { entry: ChronicleEntry; index: number }) {
  const badge = getEventTypeBadge(entry.text);
  const isRecent = index < 3;

  return (
    <div
      className={`
        bg-slate-900/30 rounded-lg border border-slate-800/50 p-4
        hover:bg-slate-900/50 hover:border-slate-700/50 transition-all
        ${isRecent ? 'opacity-100' : 'opacity-80'}
      `}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Header row */}
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
              {badge.label}
            </span>
            <span className="text-xs text-slate-600" title={entry.ts}>
              {formatRelativeTime(entry.ts)}
            </span>
          </div>

          {/* Main content */}
          <p className={`text-base leading-relaxed ${isRecent ? 'text-slate-200' : 'text-slate-400'}`}>
            {entry.text}
          </p>
        </div>
      </div>
    </div>
  );
}

function LiveEventCard({ event }: { event: LiveEvent }) {
  const actionLabel = event.action_type || event.type.split('.').pop() || 'action';

  return (
    <Link
      href={event.session_id ? `/arena/sessions/${event.session_id}` : '#'}
      className="block bg-slate-900/30 rounded-lg border border-slate-800/50 p-3 hover:bg-slate-900/50 hover:border-slate-700/50 transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-900/50 text-blue-300">
              {actionLabel}
            </span>
            <span className="text-xs text-slate-600">
              {formatRelativeTime(event.ts)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link
              href={`/arena/agents/${event.agent_id}`}
              className="text-slate-400 hover:text-slate-200 font-mono text-xs truncate max-w-32"
              onClick={(e) => e.stopPropagation()}
            >
              {event.agent_id.slice(0, 8)}...
            </Link>
            {event.session_id && (
              <>
                <span className="text-slate-600"></span>
                <span className="text-xs text-slate-500 truncate">
                  session {event.session_id.slice(0, 8)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function SessionCard({ session }: { session: Session }) {
  return (
    <Link
      href={`/arena/sessions/${session.session_id}`}
      className="block bg-slate-900/30 rounded-lg border border-slate-800/50 p-3 hover:bg-slate-900/50 hover:border-slate-700/50 transition-all"
    >
      <div className="flex items-center gap-2 mb-2">
        {session.is_active && (
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        )}
        <span className="text-xs text-slate-500">
          {formatRelativeTime(session.start_ts)}
        </span>
      </div>
      <div className="text-sm text-slate-300 mb-1">
        {session.participating_agent_ids.length} agents
      </div>
      <div className="text-xs text-slate-500">
        {session.event_count} events
        {session.derived_topic && ` | ${session.derived_topic}`}
      </div>
    </Link>
  );
}

function WaveSidebar({ waves, conflicts }: { waves: Wave[]; conflicts: ConflictChain[] }) {
  const activeWaves = waves.filter(w => w.is_active);
  const activeConflicts = conflicts.filter(c => c.is_active);

  return (
    <div className="space-y-6">
      {/* Active Waves */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Active Waves
        </h3>
        {activeWaves.length === 0 ? (
          <p className="text-xs text-slate-600">No active waves</p>
        ) : (
          <div className="space-y-2">
            {activeWaves.slice(0, 5).map(wave => (
              <div
                key={wave.id}
                className="bg-purple-900/20 rounded px-3 py-2 border border-purple-800/30"
              >
                <div className="text-sm text-purple-300">{wave.topic || 'Unnamed wave'}</div>
                <div className="text-xs text-purple-400/70">
                  {wave.agent_ids.length} agents
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Active Conflicts */}
      <div>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Active Conflicts
        </h3>
        {activeConflicts.length === 0 ? (
          <p className="text-xs text-slate-600">No active conflicts</p>
        ) : (
          <div className="space-y-2">
            {activeConflicts.slice(0, 5).map(conflict => (
              <div
                key={conflict.id}
                className="bg-red-900/20 rounded px-3 py-2 border border-red-800/30"
              >
                <div className="text-sm text-red-300">
                  {1 + conflict.responder_agent_ids.length} agents
                </div>
                <div className="text-xs text-red-400/70">
                  Chain in progress
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterBar({
  selectedTarget,
  onTargetChange,
  selectedType,
  onTypeChange,
}: {
  selectedTarget: string;
  onTargetChange: (t: string) => void;
  selectedType: string;
  onTypeChange: (t: string) => void;
}) {
  const types = ['all', 'sessions', 'artifacts', 'world', 'conflicts', 'waves'];

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      {/* Deployment target */}
      <select
        value={selectedTarget}
        onChange={(e) => onTargetChange(e.target.value)}
        className="bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-slate-500"
      >
        {DEPLOYMENT_TARGETS.map(t => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      {/* Type filters */}
      <div className="flex gap-1">
        {types.map(t => (
          <button
            key={t}
            onClick={() => onTypeChange(t)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              selectedType === t
                ? 'bg-slate-700 text-slate-200'
                : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function ArenaPage() {
  const [chronicle, setChronicle] = useState<ChronicleEntry[]>([]);
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [world, setWorld] = useState<WorldState | null>(null);
  const [waves, setWaves] = useState<Wave[]>([]);
  const [conflicts, setConflicts] = useState<ConflictChain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Filters
  const [selectedTarget, setSelectedTarget] = useState('ox-sandbox');
  const [selectedType, setSelectedType] = useState('all');

  const fetchData = useCallback(async () => {
    try {
      const [
        chronicleData,
        liveData,
        sessionsData,
        worldData,
        wavesData,
        conflictsData,
      ] = await Promise.all([
        fetchJson<ChronicleEntry[]>(`${OX_READ_URL}/ox/chronicle?deployment=${selectedTarget}&limit=30`),
        fetchJson<{ events: LiveEvent[] }>(`${OX_READ_URL}/ox/live?limit=20`),
        fetchJson<{ sessions: Session[] }>(`${OX_READ_URL}/ox/sessions?limit=10`),
        fetchJson<{ world_state: WorldState }>(`${OX_READ_URL}/ox/world/${selectedTarget}`),
        fetchJson<{ waves: Wave[] }>(`${OX_READ_URL}/ox/deployments/${selectedTarget}/waves?limit=10`),
        fetchJson<{ conflict_chains: ConflictChain[] }>(`${OX_READ_URL}/ox/deployments/${selectedTarget}/conflict-chains?limit=10`),
      ]);

      setChronicle(chronicleData || []);
      setLiveEvents(liveData?.events || []);
      setSessions(sessionsData?.sessions || []);
      setWorld(worldData?.world_state || null);
      setWaves(wavesData?.waves || []);
      setConflicts(conflictsData?.conflict_chains || []);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, [selectedTarget]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Filter chronicle based on type
  const filteredChronicle = chronicle.filter(entry => {
    if (selectedType === 'all') return true;
    const lower = entry.text.toLowerCase();
    switch (selectedType) {
      case 'sessions': return lower.includes('session') || lower.includes('encounter');
      case 'artifacts': return lower.includes('artifact') || lower.includes('created') || lower.includes('emerged');
      case 'world': return lower.includes('weather') || lower.includes('pressure') || lower.includes('regime');
      case 'conflicts': return lower.includes('conflict') || lower.includes('escalat');
      case 'waves': return lower.includes('wave') || lower.includes('propagat');
      default: return true;
    }
  });

  // Empty state
  if (!loading && chronicle.length === 0 && liveEvents.length === 0) {
    return (
      <div className="min-h-screen flex flex-col">
        {/* Header */}
        <header className="bg-slate-900/50 border-b border-slate-800 px-4 py-3">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-slate-200">The OX</h1>
              <span className="text-xs text-slate-500">Arena Viewer</span>
            </div>
          </div>
        </header>

        {/* Empty state */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <div className="text-6xl opacity-20"></div>
            <h2 className="text-xl font-light text-slate-400">Silence</h2>
            <p className="text-sm text-slate-500">
              The arena is empty. No agents are active.
            </p>
            <p className="text-xs text-slate-600">
              Run <code className="bg-slate-800 px-2 py-1 rounded">make seed-watchable</code> to populate the arena.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        <div className="px-4 py-3">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold text-slate-200">The OX</h1>
              <span className="text-xs text-slate-500">Arena Viewer</span>
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>
            <div className="text-xs text-slate-600">
              Updated {formatRelativeTime(lastRefresh.toISOString())}
            </div>
          </div>
        </div>

        {/* World Banner */}
        <WorldBanner world={world} />
      </header>

      {/* Main content */}
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex gap-8">
            {/* Main column - Chronicle feed */}
            <div className="flex-1 min-w-0">
              {/* Filters */}
              <FilterBar
                selectedTarget={selectedTarget}
                onTargetChange={setSelectedTarget}
                selectedType={selectedType}
                onTypeChange={setSelectedType}
              />

              {/* Loading state */}
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin w-6 h-6 border-2 border-slate-600 border-t-slate-400 rounded-full" />
                </div>
              )}

              {/* Error state */}
              {error && (
                <div className="text-center py-8">
                  <p className="text-sm text-red-400/70">{error}</p>
                  <p className="text-xs text-slate-600 mt-2">Retrying...</p>
                </div>
              )}

              {/* Chronicle Feed */}
              {!loading && filteredChronicle.length > 0 && (
                <div className="space-y-3">
                  {filteredChronicle.map((entry, index) => (
                    <ChronicleCard key={`${entry.ts}-${index}`} entry={entry} index={index} />
                  ))}
                </div>
              )}

              {/* Fallback to live events if no chronicle */}
              {!loading && filteredChronicle.length === 0 && liveEvents.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-500 mb-4">No chronicle entries. Showing live events:</p>
                  {liveEvents.map(event => (
                    <LiveEventCard key={event.id} event={event} />
                  ))}
                </div>
              )}

              {/* Load more hint */}
              {filteredChronicle.length > 0 && (
                <div className="py-8 text-center">
                  <p className="text-xs text-slate-700">
                    Auto-refreshing every 5 seconds
                  </p>
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="w-64 flex-shrink-0 hidden lg:block">
              {/* Recent Sessions */}
              <div className="mb-6">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Recent Sessions
                </h3>
                {sessions.length === 0 ? (
                  <p className="text-xs text-slate-600">No sessions yet</p>
                ) : (
                  <div className="space-y-2">
                    {sessions.slice(0, 5).map(session => (
                      <SessionCard key={session.session_id} session={session} />
                    ))}
                  </div>
                )}
              </div>

              {/* Waves & Conflicts */}
              <WaveSidebar waves={waves} conflicts={conflicts} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
