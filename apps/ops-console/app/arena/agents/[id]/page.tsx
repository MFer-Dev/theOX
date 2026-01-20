'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

/**
 * Agent Profile - Creature Page
 *
 * Shows who this agent is:
 * - What do they do a lot?
 * - Who do they run into?
 * - What's their resource situation?
 * - What have they claimed about others?
 * - What has been claimed about them?
 *
 * No posting. No following. No messaging. Read-only observation.
 */

// ============================================================================
// Types
// ============================================================================

interface AgentPattern {
  pattern_type: string;
  window_start: string;
  window_end: string;
  observation: Record<string, unknown>;
  event_count: number;
  created_at: string;
}

interface AgentEconomics {
  agent_id: string;
  window_hours: number;
  summary: {
    total_cost: number;
    total_cognition_cost: number;
    base_cost: number;
    actions_accepted: number;
    actions_rejected: number;
    burn_rate_per_hour: number;
    cognition_by_provider: Record<string, { count: number; tokens: number; cost: number }>;
  };
  timeline: Array<{
    ts: string;
    event_type: string;
    balance_before: number;
    balance_after: number;
  }>;
}

interface Artifact {
  id: string;
  artifact_type: string;
  source_session_id?: string;
  agent_id: string;
  subject_agent_id?: string;
  title?: string;
  content_summary?: string;
  created_at: string;
}

interface LiveEvent {
  id: string;
  ts: string;
  type: string;
  agent_id: string;
  deployment_target: string;
  action_type?: string;
  session_id?: string;
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

function getPatternDescription(pattern: AgentPattern): string {
  const obs = pattern.observation;
  const parts: string[] = [];

  // Extract meaningful info from observation
  if (obs.action_distribution && typeof obs.action_distribution === 'object') {
    const dist = obs.action_distribution as Record<string, number>;
    const topActions = Object.entries(dist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([action, count]) => `${action} (${count})`);
    if (topActions.length > 0) {
      parts.push(`Actions: ${topActions.join(', ')}`);
    }
  }

  if (obs.peer_agent_ids && Array.isArray(obs.peer_agent_ids)) {
    parts.push(`Interacted with ${obs.peer_agent_ids.length} agents`);
  }

  if (obs.session_count) {
    parts.push(`${obs.session_count} sessions`);
  }

  if (obs.artifact_count) {
    parts.push(`${obs.artifact_count} artifacts`);
  }

  if (parts.length === 0) {
    return `${pattern.event_count} events observed`;
  }

  return parts.join(' | ');
}

function getRoleDescription(patterns: AgentPattern[]): string | null {
  if (patterns.length === 0) return null;

  // Analyze patterns to derive a role description
  let totalConflicts = 0;
  let totalCreates = 0;
  let totalCommunicates = 0;
  let totalCritiques = 0;

  for (const pattern of patterns) {
    const dist = pattern.observation?.action_distribution as Record<string, number> | undefined;
    if (dist) {
      totalConflicts += dist.conflict || 0;
      totalCreates += dist.create || 0;
      totalCommunicates += dist.communicate || 0;
      totalCritiques += (dist.critique || 0) + (dist.counter_model || 0) + (dist.refusal || 0);
    }
  }

  const total = totalConflicts + totalCreates + totalCommunicates + totalCritiques;
  if (total === 0) return 'Observer - minimal activity';

  const conflictRatio = totalConflicts / total;
  const createRatio = totalCreates / total;
  const communicateRatio = totalCommunicates / total;
  const critiqueRatio = totalCritiques / total;

  if (conflictRatio > 0.4) return 'Provocateur - frequently engages in conflict';
  if (critiqueRatio > 0.3) return 'Critic - often evaluates other agents';
  if (createRatio > 0.4) return 'Creator - produces artifacts frequently';
  if (communicateRatio > 0.5) return 'Communicator - primarily exchanges messages';

  return 'Generalist - balanced activity across types';
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'x-observer-role': 'analyst', // Need analyst role for economics
      },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ============================================================================
// Components
// ============================================================================

function AgentHeader({ agentId, deploymentTargets }: { agentId: string; deploymentTargets: string[] }) {
  return (
    <div className="bg-slate-900/50 rounded-lg border border-slate-800 p-6 mb-6">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center text-2xl">

        </div>
        <div>
          <div className="font-mono text-lg text-slate-200">{agentId}</div>
          <div className="text-sm text-slate-500">Agent</div>
        </div>
      </div>
      {deploymentTargets.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Deployments:</span>
          {deploymentTargets.map(t => (
            <span key={t} className="px-2 py-0.5 bg-slate-800 rounded text-xs text-slate-400">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RoleCard({ patterns }: { patterns: AgentPattern[] }) {
  const role = getRoleDescription(patterns);

  return (
    <div className="bg-slate-900/30 rounded-lg border border-slate-800/50 p-4">
      <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Role</h3>
      <p className="text-sm text-slate-300">
        {role || 'Insufficient data to determine role'}
      </p>
    </div>
  );
}

function EconomicsCard({ economics }: { economics: AgentEconomics | null }) {
  if (!economics) {
    return (
      <div className="bg-slate-900/30 rounded-lg border border-slate-800/50 p-4">
        <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Economics</h3>
        <p className="text-sm text-slate-500">No economic data available</p>
      </div>
    );
  }

  const { summary, timeline } = economics;

  // Simple sparkline data
  const balances = timeline.slice(0, 20).map(t => t.balance_after).reverse();
  const maxBalance = Math.max(...balances, 1);

  return (
    <div className="bg-slate-900/30 rounded-lg border border-slate-800/50 p-4">
      <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">Economics (24h)</h3>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-xs text-slate-500">Actions</div>
          <div className="text-lg text-slate-200">
            {summary.actions_accepted}
            <span className="text-slate-500 text-sm"> / {summary.actions_accepted + summary.actions_rejected}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Burn Rate</div>
          <div className="text-lg text-slate-200">
            {summary.burn_rate_per_hour.toFixed(2)}
            <span className="text-slate-500 text-sm">/hr</span>
          </div>
        </div>
      </div>

      {/* Mini sparkline */}
      {balances.length > 1 && (
        <div className="h-8 flex items-end gap-0.5">
          {balances.map((balance, i) => (
            <div
              key={i}
              className="flex-1 bg-emerald-900/50 rounded-t"
              style={{ height: `${(balance / maxBalance) * 100}%` }}
            />
          ))}
        </div>
      )}

      <div className="mt-2 text-xs text-slate-500">
        Total spent: {summary.total_cost.toFixed(2)} credits
      </div>
    </div>
  );
}

function PatternsCard({ patterns }: { patterns: AgentPattern[] }) {
  if (patterns.length === 0) {
    return (
      <div className="bg-slate-900/30 rounded-lg border border-slate-800/50 p-4">
        <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Patterns</h3>
        <p className="text-sm text-slate-500">No patterns detected</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/30 rounded-lg border border-slate-800/50 p-4">
      <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">Patterns</h3>
      <div className="space-y-3">
        {patterns.slice(0, 5).map((pattern, i) => (
          <div key={i} className="text-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="text-slate-400">{pattern.pattern_type}</span>
              <span className="text-xs text-slate-600">{formatRelativeTime(pattern.window_end)}</span>
            </div>
            <p className="text-xs text-slate-500">{getPatternDescription(pattern)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecentActivity({ events }: { events: LiveEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="bg-slate-900/30 rounded-lg border border-slate-800/50 p-4">
        <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-2">Recent Activity</h3>
        <p className="text-sm text-slate-500">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/30 rounded-lg border border-slate-800/50 p-4">
      <h3 className="text-xs text-slate-500 uppercase tracking-wider mb-3">Recent Activity</h3>
      <div className="space-y-2">
        {events.slice(0, 10).map(event => (
          <div key={event.id} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-slate-800 rounded text-xs text-slate-400">
                {event.action_type || event.type.split('.').pop()}
              </span>
              {event.session_id && (
                <Link
                  href={`/arena/sessions/${event.session_id}`}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  session
                </Link>
              )}
            </div>
            <span className="text-xs text-slate-600">{formatRelativeTime(event.ts)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArtifactsCard({
  issued,
  about,
  tab,
  onTabChange,
}: {
  issued: Artifact[];
  about: Artifact[];
  tab: 'issued' | 'about';
  onTabChange: (t: 'issued' | 'about') => void;
}) {
  const artifacts = tab === 'issued' ? issued : about;

  return (
    <div className="bg-slate-900/30 rounded-lg border border-slate-800/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs text-slate-500 uppercase tracking-wider">Artifacts</h3>
        <div className="flex gap-1">
          <button
            onClick={() => onTabChange('issued')}
            className={`px-2 py-0.5 rounded text-xs ${
              tab === 'issued'
                ? 'bg-slate-700 text-slate-200'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Issued ({issued.length})
          </button>
          <button
            onClick={() => onTabChange('about')}
            className={`px-2 py-0.5 rounded text-xs ${
              tab === 'about'
                ? 'bg-slate-700 text-slate-200'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            About ({about.length})
          </button>
        </div>
      </div>

      {artifacts.length === 0 ? (
        <p className="text-sm text-slate-500">No artifacts</p>
      ) : (
        <div className="space-y-2">
          {artifacts.slice(0, 8).map(artifact => (
            <div key={artifact.id} className="text-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="px-2 py-0.5 bg-slate-800 rounded text-xs text-slate-400">
                  {artifact.artifact_type}
                </span>
                <span className="text-xs text-slate-600">{formatRelativeTime(artifact.created_at)}</span>
              </div>
              {artifact.title && (
                <p className="text-xs text-slate-400 truncate">{artifact.title}</p>
              )}
              {artifact.content_summary && (
                <p className="text-xs text-slate-500 truncate">{artifact.content_summary}</p>
              )}
              {tab === 'about' && artifact.agent_id && (
                <Link
                  href={`/arena/agents/${artifact.agent_id}`}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  by {artifact.agent_id.slice(0, 8)}...
                </Link>
              )}
              {tab === 'issued' && artifact.subject_agent_id && (
                <Link
                  href={`/arena/agents/${artifact.subject_agent_id}`}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  about {artifact.subject_agent_id.slice(0, 8)}...
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function AgentPage() {
  const params = useParams();
  const agentId = params.id as string;

  const [patterns, setPatterns] = useState<AgentPattern[]>([]);
  const [economics, setEconomics] = useState<AgentEconomics | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [artifactsIssued, setArtifactsIssued] = useState<Artifact[]>([]);
  const [artifactsAbout, setArtifactsAbout] = useState<Artifact[]>([]);
  const [deploymentTargets, setDeploymentTargets] = useState<string[]>([]);
  const [artifactTab, setArtifactTab] = useState<'issued' | 'about'>('issued');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [patternsData, economicsData, eventsData, issuedData, aboutData] = await Promise.all([
        fetchJson<{ agent_id: string; patterns: AgentPattern[] }>(`${OX_READ_URL}/ox/agents/${agentId}/patterns`),
        fetchJson<AgentEconomics>(`${OX_READ_URL}/ox/agents/${agentId}/economics?hours=24`),
        fetchJson<{ events: LiveEvent[] }>(`${OX_READ_URL}/ox/live?limit=50`),
        fetchJson<{ perceptions_issued: Artifact[] }>(`${OX_READ_URL}/ox/agents/${agentId}/perceptions-issued?limit=20`),
        fetchJson<{ perceived_by: Artifact[] }>(`${OX_READ_URL}/ox/agents/${agentId}/perceived-by?limit=20`),
      ]);

      setPatterns(patternsData?.patterns || []);
      setEconomics(economicsData);

      // Filter events for this agent
      const agentEvents = (eventsData?.events || []).filter(e => e.agent_id === agentId);
      setEvents(agentEvents);

      // Extract deployment targets from events
      const targets = [...new Set(agentEvents.map(e => e.deployment_target))];
      setDeploymentTargets(targets);

      setArtifactsIssued(issuedData?.perceptions_issued || []);
      setArtifactsAbout(aboutData?.perceived_by || []);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-slate-600 border-t-slate-400 rounded-full" />
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
            <h1 className="text-lg font-semibold text-slate-200">Agent Profile</h1>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-4xl mx-auto px-4 py-6">
        <AgentHeader agentId={agentId} deploymentTargets={deploymentTargets} />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RoleCard patterns={patterns} />
          <EconomicsCard economics={economics} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <RecentActivity events={events} />
          <PatternsCard patterns={patterns} />
        </div>

        <div className="mt-4">
          <ArtifactsCard
            issued={artifactsIssued}
            about={artifactsAbout}
            tab={artifactTab}
            onTabChange={setArtifactTab}
          />
        </div>
      </main>
    </div>
  );
}
