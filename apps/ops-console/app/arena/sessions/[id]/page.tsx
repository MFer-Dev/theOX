'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

/**
 * Session Thread View - The Money Shot
 *
 * Shows what happened inside a specific session/interaction.
 * This is where "what are they talking about?" becomes visible.
 */

// ============================================================================
// Types
// ============================================================================

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

interface SessionEvent {
  event_id: string;
  agent_id: string;
  ts: string;
  event_type: string;
  action_type?: string;
  summary?: Record<string, unknown>;
}

interface SessionDetail {
  session: Session;
  events: SessionEvent[];
}

interface Artifact {
  id: string;
  artifact_type: string;
  source_session_id?: string;
  agent_id: string;
  subject_agent_id?: string;
  title?: string;
  content_summary?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

interface WorldState {
  regime_name: string;
  weather_state: string;
}

// ============================================================================
// Constants
// ============================================================================

const OX_READ_URL = process.env.NEXT_PUBLIC_OX_READ_URL || 'http://localhost:4018';

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

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(startTs: string, endTs: string | null): string {
  if (!endTs) return 'ongoing';
  const start = new Date(startTs).getTime();
  const end = new Date(endTs).getTime();
  const diffMs = end - start;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ${diffSec % 60}s`;
  return `${Math.floor(diffSec / 3600)}h ${Math.floor((diffSec % 3600) / 60)}m`;
}

function getActionColor(actionType: string | undefined): string {
  if (!actionType) return 'bg-slate-700';
  const lower = actionType.toLowerCase();
  if (lower.includes('conflict') || lower.includes('refusal')) return 'bg-red-900/50';
  if (lower.includes('create') || lower.includes('communicate')) return 'bg-emerald-900/50';
  if (lower.includes('critique') || lower.includes('counter')) return 'bg-amber-900/50';
  if (lower.includes('associate') || lower.includes('exchange')) return 'bg-blue-900/50';
  return 'bg-slate-700';
}

function renderArtifactSummary(artifact: Artifact): string {
  if (artifact.content_summary) {
    return artifact.content_summary;
  }

  const meta = artifact.metadata || {};
  const parts: string[] = [];

  // Type-specific rendering
  switch (artifact.artifact_type) {
    case 'critique':
      parts.push(`Critique of agent ${artifact.subject_agent_id?.slice(0, 8) || 'unknown'}`);
      if (meta.focus) parts.push(`Focus: ${meta.focus}`);
      break;
    case 'counter_model':
      parts.push(`Counter-model to agent ${artifact.subject_agent_id?.slice(0, 8) || 'unknown'}`);
      break;
    case 'refusal':
      parts.push(`Refusal to engage with ${artifact.subject_agent_id?.slice(0, 8) || 'unknown'}`);
      if (meta.reason) parts.push(`Reason: ${meta.reason}`);
      break;
    case 'rederivation':
      parts.push(`Re-derivation of ${artifact.subject_agent_id?.slice(0, 8) || 'unknown'}'s position`);
      break;
    case 'proposal':
      parts.push('Proposal');
      if (meta.topic) parts.push(`Topic: ${meta.topic}`);
      break;
    case 'message':
      parts.push('Message');
      break;
    case 'diagram':
      parts.push('Diagram');
      if (meta.title) parts.push(`"${meta.title}"`);
      break;
    case 'dataset':
      parts.push('Dataset');
      if (meta.rows) parts.push(`${meta.rows} rows`);
      break;
    default:
      parts.push(`${artifact.artifact_type} artifact`);
  }

  return parts.join('. ');
}

function renderEventSummary(event: SessionEvent): string {
  const summary = event.summary;
  if (!summary) {
    return `${event.action_type || event.event_type.split('.').pop() || 'action'}`;
  }

  // Try to extract meaningful content from summary
  if (typeof summary === 'object') {
    if (summary.text) return String(summary.text);
    if (summary.message) return String(summary.message);
    if (summary.description) return String(summary.description);
    if (summary.title) return String(summary.title);
    if (summary.topic) return `Topic: ${summary.topic}`;
    if (summary.reason) return `Reason: ${summary.reason}`;
  }

  return `${event.action_type || event.event_type.split('.').pop() || 'action'}`;
}

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
// Components
// ============================================================================

function SessionHeader({ session, world }: { session: Session; world: WorldState | null }) {
  return (
    <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-4 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            {session.is_active && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            )}
            <span className="text-xs text-slate-500 font-mono">
              {session.session_id}
            </span>
          </div>
          <div className="text-lg font-medium text-slate-200">
            {session.derived_topic || 'Session'}
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="text-slate-500">Duration</div>
          <div className="text-slate-300 font-medium">
            {formatDuration(session.start_ts, session.end_ts)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-slate-500 text-xs uppercase">Started</div>
          <div className="text-slate-300">{formatRelativeTime(session.start_ts)}</div>
        </div>
        <div>
          <div className="text-slate-500 text-xs uppercase">Events</div>
          <div className="text-slate-300">{session.event_count}</div>
        </div>
        <div>
          <div className="text-slate-500 text-xs uppercase">Participants</div>
          <div className="text-slate-300">{session.participating_agent_ids.length} agents</div>
        </div>
        <div>
          <div className="text-slate-500 text-xs uppercase">Target</div>
          <div className="text-slate-300">{session.deployment_target}</div>
        </div>
      </div>

      {world && (
        <div className="mt-4 pt-4 border-t border-slate-800">
          <div className="text-xs text-slate-500 mb-1">World state at session start</div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-400">Weather: {world.weather_state}</span>
            <span className="text-slate-400">Regime: {world.regime_name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ParticipantChips({ agentIds }: { agentIds: string[] }) {
  return (
    <div className="mb-6">
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Participants</div>
      <div className="flex flex-wrap gap-2">
        {agentIds.map(agentId => (
          <Link
            key={agentId}
            href={`/arena/agents/${agentId}`}
            className="bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700 rounded-full px-3 py-1 text-xs font-mono text-slate-300 transition-colors"
          >
            {agentId.slice(0, 12)}...
          </Link>
        ))}
      </div>
    </div>
  );
}

function EventThread({ events }: { events: SessionEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        No events in this session
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {events.map((event, index) => (
        <div
          key={event.event_id}
          className="flex gap-4"
        >
          {/* Timeline line */}
          <div className="flex flex-col items-center">
            <div className={`w-3 h-3 rounded-full ${getActionColor(event.action_type)}`} />
            {index < events.length - 1 && (
              <div className="w-0.5 flex-1 bg-slate-800 mt-2" />
            )}
          </div>

          {/* Event content */}
          <div className="flex-1 pb-4">
            <div className="bg-slate-900/30 rounded-lg border border-slate-800/50 p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/arena/agents/${event.agent_id}`}
                    className="text-sm font-mono text-slate-400 hover:text-slate-200"
                  >
                    {event.agent_id.slice(0, 12)}...
                  </Link>
                  <span className={`px-2 py-0.5 rounded text-xs ${getActionColor(event.action_type)} text-slate-300`}>
                    {event.action_type || event.event_type.split('.').pop() || 'action'}
                  </span>
                </div>
                <span className="text-xs text-slate-600">
                  {formatTime(event.ts)}
                </span>
              </div>

              <div className="text-slate-300 text-sm">
                {renderEventSummary(event)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ArtifactPanel({ artifacts }: { artifacts: Artifact[] }) {
  if (artifacts.length === 0) {
    return (
      <div className="text-center py-4 text-slate-500 text-sm">
        No artifacts produced
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {artifacts.map(artifact => (
        <div
          key={artifact.id}
          className="bg-slate-900/30 rounded-lg border border-slate-800/50 p-3"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded text-xs bg-emerald-900/50 text-emerald-300">
              {artifact.artifact_type}
            </span>
            <span className="text-xs text-slate-600">
              {formatRelativeTime(artifact.created_at)}
            </span>
          </div>
          {artifact.title && (
            <div className="text-sm font-medium text-slate-300 mb-1">
              {artifact.title}
            </div>
          )}
          <div className="text-sm text-slate-400">
            {renderArtifactSummary(artifact)}
          </div>
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Link
              href={`/arena/agents/${artifact.agent_id}`}
              className="text-slate-500 hover:text-slate-300"
            >
              By {artifact.agent_id.slice(0, 8)}
            </Link>
            {artifact.subject_agent_id && (
              <>
                <span className="text-slate-600"></span>
                <Link
                  href={`/arena/agents/${artifact.subject_agent_id}`}
                  className="text-slate-500 hover:text-slate-300"
                >
                  About {artifact.subject_agent_id.slice(0, 8)}
                </Link>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function SessionPage() {
  const params = useParams();
  const sessionId = params.id as string;

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [world, setWorld] = useState<WorldState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [sessionData, artifactsData] = await Promise.all([
        fetchJson<SessionDetail>(`${OX_READ_URL}/ox/sessions/${sessionId}`),
        fetchJson<{ artifacts: Artifact[] }>(`${OX_READ_URL}/ox/artifacts?session_id=${sessionId}`),
      ]);

      if (!sessionData) {
        setError('Session not found');
        setLoading(false);
        return;
      }

      setSession(sessionData);
      setArtifacts(artifactsData?.artifacts || []);

      // Fetch world state for the deployment target
      const worldData = await fetchJson<{ world_state: WorldState }>(
        `${OX_READ_URL}/ox/world/${sessionData.session.deployment_target}`
      );
      setWorld(worldData?.world_state || null);

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch session');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchData();
    // Auto-refresh for active sessions
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-slate-600 border-t-slate-400 rounded-full" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8">
        <div className="text-red-400 mb-4">{error || 'Session not found'}</div>
        <Link href="/arena" className="text-slate-400 hover:text-slate-200 text-sm">
           Back to Arena
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        <div className="px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center gap-4">
            <Link href="/arena" className="text-slate-400 hover:text-slate-200">
               Back
            </Link>
            <div className="text-slate-600">|</div>
            <h1 className="text-lg font-semibold text-slate-200">Session Thread</h1>
            {session.session.is_active && (
              <span className="ml-auto flex items-center gap-2 text-sm text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        <SessionHeader session={session.session} world={world} />

        <ParticipantChips agentIds={session.session.participating_agent_ids} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Thread column */}
          <div className="lg:col-span-2">
            <h2 className="text-xs text-slate-500 uppercase tracking-wider mb-4">Timeline</h2>
            <EventThread events={session.events} />
          </div>

          {/* Artifacts column */}
          <div>
            <h2 className="text-xs text-slate-500 uppercase tracking-wider mb-4">
              Artifacts ({artifacts.length})
            </h2>
            <ArtifactPanel artifacts={artifacts} />
          </div>
        </div>
      </main>
    </div>
  );
}
