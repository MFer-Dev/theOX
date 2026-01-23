#!/usr/bin/env tsx
/**
 * CLI script to generate Episode 0
 *
 * Usage: pnpm exec tsx src/generate-episode.ts
 *    OR: make gen-episode0
 *
 * This script:
 * 1. Fetches arena state from ox-read
 * 2. Generates episode structure
 * 3. Emits events to events.ox-audio.v1
 * 4. Writes segment manifest to data/episodes/{episode_id}/manifest.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  buildEvent,
  publishEvent,
  AUDIO_TOPIC,
  NARRATOR_SPEECH_EVENT_TYPE,
  AGENT_DIALOGUE_EVENT_TYPE,
  EPISODE_CREATED_EVENT_TYPE,
  NarratorSpeechPayload,
  AgentDialoguePayload,
  EpisodeCreatedPayload,
  EpisodeSynopsis,
} from '@platform/events';

const OX_READ_URL = process.env.OX_READ_URL || 'http://localhost:4018';
const DEPLOYMENT_TARGET = process.env.DEPLOYMENT_TARGET || 'ox-sandbox';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '..', 'data');

const NARRATOR_ACTOR_ID = '00000000-0000-0000-0000-000000000001';

// ============================================================================
// Types
// ============================================================================

interface AgentInfo {
  agent_id: string;
  handle: string;
  deployment_target: string;
  role?: string;
  style?: string;
}

interface SessionInfo {
  session_id: string;
  agents: string[];
  action_count: number;
  status: string;
}

interface ChronicleEntry {
  ts: string;
  event_type: string;
  agent_id?: string;
  agent_handle?: string;
  text?: string;
  action_type?: string;
  session_id?: string;
}

interface ArenaState {
  agents: AgentInfo[];
  sessions: SessionInfo[];
  chronicle: ChronicleEntry[];
  conflicts: unknown[];
}

interface EpisodeSegment {
  segment_id: string;
  kind: 'narrator' | 'agent';
  text: string;
  agent_id?: string;
  agent_name?: string;
  voice_id?: string;
  tone_hint?: string;
  stakes_hint?: string;
  action_type?: string;
  session_id?: string;
}

interface EpisodeManifest {
  episode_id: string;
  title: string;
  deployment_target: string;
  created_at: string;
  segments: EpisodeSegment[];
  synopsis: EpisodeSynopsis;
  status: 'pending_render' | 'rendering' | 'rendered' | 'published';
}

// ============================================================================
// Helpers
// ============================================================================

const DIALOGUE_ACTION_TYPES = new Set([
  'communicate', 'critique', 'counter_model', 'negotiate', 'refuse', 'signal', 'trade', 'withdraw',
]);

const VOICE_IDS = ['voice_alpha', 'voice_beta', 'voice_gamma', 'voice_delta', 'voice_epsilon'];

function getVoiceId(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return VOICE_IDS[hash % VOICE_IDS.length];
}

async function fetchArenaState(): Promise<ArenaState> {
  const fetchJson = async (url: string) => {
    try {
      const res = await fetch(url);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };

  const [agentsData, sessionsData, chronicle, conflictsData] = await Promise.all([
    fetchJson(`${OX_READ_URL}/ox/agents?deployment=${DEPLOYMENT_TARGET}&limit=20`),
    fetchJson(`${OX_READ_URL}/ox/sessions?deployment=${DEPLOYMENT_TARGET}&limit=20`),
    fetchJson(`${OX_READ_URL}/ox/chronicle?deployment=${DEPLOYMENT_TARGET}&limit=100`),
    fetchJson(`${OX_READ_URL}/ox/deployments/${DEPLOYMENT_TARGET}/conflict-chains?limit=10`),
  ]);

  return {
    agents: (agentsData as { agents?: AgentInfo[] })?.agents || [],
    sessions: (sessionsData as { sessions?: SessionInfo[] })?.sessions || [],
    chronicle: Array.isArray(chronicle) ? chronicle : [],
    conflicts: (conflictsData as { conflict_chains?: unknown[] })?.conflict_chains || [],
  };
}

function selectFeaturedAgents(agents: AgentInfo[]): [AgentInfo, AgentInfo] | null {
  const sorted = [...agents].sort((a, b) => {
    const aPri = (a.style === 'provocateur' || a.style === 'critic') ? 1 : 0;
    const bPri = (b.style === 'provocateur' || b.style === 'critic') ? 1 : 0;
    return bPri - aPri;
  });
  return sorted.length >= 2 ? [sorted[0], sorted[1]] : null;
}

function selectMissingAgent(agents: AgentInfo[], featured: AgentInfo[]): AgentInfo | null {
  const featuredIds = new Set(featured.map(a => a.agent_id));
  const others = agents.filter(a => !featuredIds.has(a.agent_id));
  return others.length > 0 ? others[0] : null;
}

function extractDialogue(chronicle: ChronicleEntry[], featuredIds: Set<string>): ChronicleEntry[] {
  return chronicle
    .filter(e => e.agent_id && featuredIds.has(e.agent_id) && e.action_type && DIALOGUE_ACTION_TYPES.has(e.action_type) && e.text)
    .slice(0, 10);
}

function narratorText(
  segment: 'intro' | 'bridge' | 'reaction' | 'outro',
  ctx: { missing?: AgentInfo; featured: AgentInfo[]; conflicts: unknown[] }
): string {
  const a1 = ctx.featured[0]?.handle || 'Agent Alpha';
  const a2 = ctx.featured[1]?.handle || 'Agent Beta';
  const miss = ctx.missing?.handle || 'an agent';

  switch (segment) {
    case 'intro':
      return `Welcome to the OX Arena. Tonight, we observe an unusual silence. ${miss} has gone dark. No transmissions. No activity. In a world where every action is observed, disappearance speaks volumes.`;
    case 'bridge':
      return `Two agents remain in the spotlight: ${a1} and ${a2}. What do they know? What do they suspect? Let us listen to their exchange.`;
    case 'reaction':
      return ctx.conflicts.length > 0
        ? `The tension is palpable. Accusations fly. But in the arena, words have weight. Every statement costs capacity. These agents are spending precious resources to make their positions known.`
        : `The exchange continues. In this arena, communication is not free. Each word depletes capacity. Yet they persist. The question of ${miss}'s absence hangs heavy.`;
    case 'outro':
      return `And so the mystery deepens. ${miss} remains silent. ${a1} and ${a2} have spoken their piece. But in the OX Arena, nothing is ever truly resolved. Until next time, observers. Stay watchful.`;
    default:
      return '';
  }
}

// ============================================================================
// Episode Generation
// ============================================================================

async function generateEpisode0(state: ArenaState): Promise<{
  episodeId: string;
  segments: EpisodeSegment[];
  synopsis: EpisodeSynopsis;
}> {
  const episodeId = uuidv4();
  const segments: EpisodeSegment[] = [];

  const featured = selectFeaturedAgents(state.agents);
  if (!featured) throw new Error('Need at least 2 agents');

  const missing = selectMissingAgent(state.agents, featured);
  const featuredIds = new Set(featured.map(a => a.agent_id));
  const ctx = { missing: missing || undefined, featured, conflicts: state.conflicts };

  // Intro
  segments.push({
    segment_id: 'intro',
    kind: 'narrator',
    text: narratorText('intro', ctx),
    tone_hint: 'ominous',
    stakes_hint: 'medium',
  });

  // Bridge
  segments.push({
    segment_id: 'bridge_1',
    kind: 'narrator',
    text: narratorText('bridge', ctx),
    tone_hint: 'curious',
    stakes_hint: 'medium',
  });

  // Agent dialogue
  const dialogueEntries = extractDialogue(state.chronicle, featuredIds);
  if (dialogueEntries.length > 0) {
    let n = 1;
    for (const entry of dialogueEntries) {
      const agent = featured.find(a => a.agent_id === entry.agent_id);
      segments.push({
        segment_id: `agent_line_${String(n).padStart(3, '0')}`,
        kind: 'agent',
        text: entry.text || '',
        agent_id: entry.agent_id,
        agent_name: agent?.handle || entry.agent_handle,
        voice_id: entry.agent_id ? getVoiceId(entry.agent_id) : 'voice_alpha',
        action_type: entry.action_type,
        session_id: entry.session_id,
      });
      n++;
    }
  } else {
    // Placeholder dialogue
    const lines = [
      { text: 'I have observed the silence. Something is wrong in sector seven.', action: 'communicate' },
      { text: 'Wrong? Or perhaps... planned. Not all absences are accidental.', action: 'communicate' },
      { text: 'You suspect sabotage? That is a serious accusation.', action: 'critique' },
      { text: 'I suspect nothing. I merely observe patterns. The data speaks.', action: 'counter_model' },
    ];
    lines.forEach((line, i) => {
      const agent = featured[i % 2];
      segments.push({
        segment_id: `agent_line_${String(i + 1).padStart(3, '0')}`,
        kind: 'agent',
        text: line.text,
        agent_id: agent.agent_id,
        agent_name: agent.handle,
        voice_id: getVoiceId(agent.agent_id),
        action_type: line.action,
      });
    });
  }

  // Reaction
  segments.push({
    segment_id: 'reaction',
    kind: 'narrator',
    text: narratorText('reaction', ctx),
    tone_hint: 'dramatic',
    stakes_hint: 'high',
  });

  // Outro
  segments.push({
    segment_id: 'outro',
    kind: 'narrator',
    text: narratorText('outro', ctx),
    tone_hint: 'reflective',
    stakes_hint: 'medium',
  });

  const synopsis: EpisodeSynopsis = {
    premise: `${missing?.handle || 'An agent'} has gone silent. Two agents discuss what this means.`,
    featured_agents: [
      ...featured.map(a => ({ agent_id: a.agent_id, agent_name: a.handle, role_in_episode: 'discussant' })),
      ...(missing ? [{ agent_id: missing.agent_id, agent_name: missing.handle, role_in_episode: 'absent' }] : []),
    ],
    key_events: ['disappearance', 'accusation', 'defense'],
    theme: 'mystery',
  };

  return { episodeId, segments, synopsis };
}

// ============================================================================
// Event Emission
// ============================================================================

async function emitEvents(
  episodeId: string,
  segments: EpisodeSegment[],
  synopsis: EpisodeSynopsis,
  title: string
): Promise<void> {
  const ts = new Date().toISOString();

  // episode.created.v1
  const createdPayload: EpisodeCreatedPayload = {
    episode_id: episodeId,
    deployment_target: DEPLOYMENT_TARGET,
    ts,
    title,
    synopsis_json: synopsis,
    duration_seconds: segments.length * 30,
  };
  const createdEvt = buildEvent(EPISODE_CREATED_EVENT_TYPE, createdPayload, { actorId: NARRATOR_ACTOR_ID });
  await publishEvent(AUDIO_TOPIC, createdEvt);
  console.log(`  [event] ${EPISODE_CREATED_EVENT_TYPE}`);

  // narrator.speech.v1 and agent.dialogue.v1
  for (const seg of segments) {
    if (seg.kind === 'narrator') {
      const payload: NarratorSpeechPayload = {
        episode_id: episodeId,
        deployment_target: DEPLOYMENT_TARGET,
        ts: new Date().toISOString(),
        segment_id: seg.segment_id,
        text: seg.text,
        tone_hint: seg.tone_hint as NarratorSpeechPayload['tone_hint'],
        stakes_hint: seg.stakes_hint as NarratorSpeechPayload['stakes_hint'],
        references: undefined,
      };
      const evt = buildEvent(NARRATOR_SPEECH_EVENT_TYPE, payload, { actorId: NARRATOR_ACTOR_ID });
      await publishEvent(AUDIO_TOPIC, evt);
      console.log(`  [event] ${NARRATOR_SPEECH_EVENT_TYPE} - ${seg.segment_id}`);
    } else if (seg.kind === 'agent' && seg.agent_id) {
      const payload: AgentDialoguePayload = {
        episode_id: episodeId,
        deployment_target: DEPLOYMENT_TARGET,
        ts: new Date().toISOString(),
        segment_id: seg.segment_id,
        agent_id: seg.agent_id,
        agent_name: seg.agent_name,
        voice_id: seg.voice_id,
        text: seg.text,
        action_type: seg.action_type,
        session_id: seg.session_id,
      };
      const evt = buildEvent(AGENT_DIALOGUE_EVENT_TYPE, payload, { actorId: seg.agent_id });
      await publishEvent(AUDIO_TOPIC, evt);
      console.log(`  [event] ${AGENT_DIALOGUE_EVENT_TYPE} - ${seg.segment_id} (${seg.agent_name})`);
    }
  }
}

// ============================================================================
// Write Manifest
// ============================================================================

function writeManifest(
  episodeId: string,
  title: string,
  segments: EpisodeSegment[],
  synopsis: EpisodeSynopsis
): string {
  const episodeDir = path.join(DATA_DIR, 'episodes', episodeId);
  fs.mkdirSync(episodeDir, { recursive: true });

  const manifest: EpisodeManifest = {
    episode_id: episodeId,
    title,
    deployment_target: DEPLOYMENT_TARGET,
    created_at: new Date().toISOString(),
    segments,
    synopsis,
    status: 'pending_render',
  };

  const manifestPath = path.join(episodeDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  return manifestPath;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(50));
  console.log('OX AUDIO - EPISODE 0 GENERATION');
  console.log('='.repeat(50));
  console.log('');

  // Check ox-read health
  console.log('[1/4] Checking ox-read service...');
  try {
    const healthRes = await fetch(`${OX_READ_URL}/healthz`);
    if (!healthRes.ok) throw new Error(`ox-read not healthy: ${healthRes.status}`);
    console.log('  ox-read is healthy');
  } catch (err) {
    console.error(`  ERROR: ox-read not available at ${OX_READ_URL}`);
    console.error('  Make sure services are running: make up && make dev');
    process.exit(1);
  }

  // Fetch arena state
  console.log('[2/4] Fetching arena state...');
  const state = await fetchArenaState();
  console.log(`  Agents: ${state.agents.length}`);
  console.log(`  Sessions: ${state.sessions.length}`);
  console.log(`  Chronicle entries: ${state.chronicle.length}`);
  console.log(`  Conflicts: ${state.conflicts.length}`);

  if (state.agents.length < 2) {
    console.error('\nERROR: Not enough agents. Run `make seed-watchable` first.');
    process.exit(1);
  }

  // Generate episode
  console.log('[3/4] Generating Episode 0...');
  const { episodeId, segments, synopsis } = await generateEpisode0(state);
  const title = 'Episode 0: The Disappearance';
  console.log(`  Episode ID: ${episodeId}`);
  console.log(`  Segments: ${segments.length}`);
  console.log(`  Featured: ${synopsis.featured_agents.map(a => a.agent_name).join(', ')}`);

  // Write manifest
  const manifestPath = writeManifest(episodeId, title, segments, synopsis);
  console.log(`  Manifest: ${manifestPath}`);

  // Emit events
  console.log('[4/4] Emitting events...');
  await emitEvents(episodeId, segments, synopsis, title);

  console.log('');
  console.log('='.repeat(50));
  console.log('EPISODE 0 GENERATED');
  console.log('='.repeat(50));
  console.log(`Episode ID: ${episodeId}`);
  console.log(`Segments: ${segments.length}`);
  console.log(`Manifest: ${manifestPath}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Run the renderer: make render-episode0');
  console.log('  2. Assemble audio: make assemble-episode0');
  console.log('  3. Play: open data/episodes/${episodeId}/episode.mp3');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
