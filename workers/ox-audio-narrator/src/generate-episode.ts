#!/usr/bin/env tsx
/**
 * CLI script to generate Episode 0
 *
 * Usage: pnpm exec tsx src/generate-episode.ts [--outline <template.json>] [--hook "Custom hook text"]
 *    OR: make gen-episode0
 *
 * This script:
 * 1. Loads agent identity pack for personas and voices
 * 2. Fetches arena state from ox-read
 * 3. Generates episode structure (optionally from outline template)
 * 4. Emits events to events.ox-audio.v1 (including clip markers)
 * 5. Writes segment manifest to data/episodes/{episode_id}/manifest.json
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
  CLIP_MARKED_EVENT_TYPE,
  NarratorSpeechPayload,
  AgentDialoguePayload,
  EpisodeCreatedPayload,
  ClipMarkedPayload,
  EpisodeSynopsis,
} from '@platform/events';

const OX_READ_URL = process.env.OX_READ_URL || 'http://localhost:4018';
const AGENTS_URL = process.env.AGENTS_URL || 'http://localhost:4017';
const DEPLOYMENT_TARGET = process.env.DEPLOYMENT_TARGET || 'ox-sandbox';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '..', 'data');
const IDENTITY_DIR = process.env.IDENTITY_DIR || path.join(process.cwd(), '..', '..', 'platform', 'audio-identity');

const NARRATOR_ACTOR_ID = '00000000-0000-0000-0000-000000000001';

// ============================================================================
// Identity Pack Types
// ============================================================================

interface AgentIdentity {
  persona_bio: string;
  tone: string;
  voice_id: string;
}

interface IdentityPack {
  deployment_target: string;
  voices: Record<string, { provider: string; voice_name: string; description?: string }>;
  agents: Record<string, AgentIdentity>;
  default_agent: AgentIdentity;
}

// ============================================================================
// Episode Outline Template Types
// ============================================================================

type BeatType = 'setup' | 'tension' | 'climax' | 'reflection' | 'hook' | 'transition' | 'reveal';

interface ActBeat {
  beat_type: BeatType;
  description?: string;
  min_segments?: number;
  max_segments?: number;
}

interface EpisodeOutline {
  template_name: string;
  num_acts: number;
  acts: Array<{
    act_number: number;
    beats: ActBeat[];
  }>;
  hook?: string; // Optional opening hook text
}

const DEFAULT_OUTLINE: EpisodeOutline = {
  template_name: 'default',
  num_acts: 3,
  acts: [
    {
      act_number: 1,
      beats: [
        { beat_type: 'hook', description: 'Opening hook to grab attention' },
        { beat_type: 'setup', description: 'Establish the situation', min_segments: 1, max_segments: 2 },
      ],
    },
    {
      act_number: 2,
      beats: [
        { beat_type: 'tension', description: 'Build conflict', min_segments: 2, max_segments: 6 },
        { beat_type: 'climax', description: 'Peak of the conflict', min_segments: 1, max_segments: 2 },
      ],
    },
    {
      act_number: 3,
      beats: [
        { beat_type: 'reflection', description: 'Narrator commentary', min_segments: 1, max_segments: 1 },
        { beat_type: 'transition', description: 'Tease next episode', min_segments: 1, max_segments: 1 },
      ],
    },
  ],
};

// ============================================================================
// Identity Pack Loading
// ============================================================================

let identityPack: IdentityPack | null = null;

function loadIdentityPack(): IdentityPack {
  if (identityPack) return identityPack;

  const packPath = path.join(IDENTITY_DIR, `${DEPLOYMENT_TARGET}.json`);
  if (fs.existsSync(packPath)) {
    try {
      identityPack = JSON.parse(fs.readFileSync(packPath, 'utf-8'));
      console.log(`  Loaded identity pack: ${packPath}`);
    } catch (err) {
      console.warn(`  Warning: Failed to load identity pack: ${err}`);
    }
  } else {
    console.warn(`  Warning: No identity pack found at ${packPath}`);
  }

  // Return a default pack if not loaded
  if (!identityPack) {
    identityPack = {
      deployment_target: DEPLOYMENT_TARGET,
      voices: {},
      agents: {},
      default_agent: {
        persona_bio: 'An agent in the arena.',
        tone: 'neutral',
        voice_id: 'voice_alpha',
      },
    };
  }

  return identityPack;
}

function getAgentIdentity(handle: string): AgentIdentity {
  const pack = loadIdentityPack();
  return pack.agents[handle] || pack.default_agent;
}

// ============================================================================
// Outline Loading
// ============================================================================

function loadOutline(outlinePath?: string): EpisodeOutline {
  if (!outlinePath) return DEFAULT_OUTLINE;

  if (fs.existsSync(outlinePath)) {
    try {
      const outline = JSON.parse(fs.readFileSync(outlinePath, 'utf-8'));
      console.log(`  Loaded outline template: ${outlinePath}`);
      return outline;
    } catch (err) {
      console.warn(`  Warning: Failed to load outline: ${err}`);
    }
  }

  return DEFAULT_OUTLINE;
}

// Parse CLI args for outline and hook
function parseArgs(): { outlinePath?: string; hook?: string } {
  const args = process.argv.slice(2);
  let outlinePath: string | undefined;
  let hook: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--outline' && args[i + 1]) {
      outlinePath = args[i + 1];
      i++;
    } else if (args[i] === '--hook' && args[i + 1]) {
      hook = args[i + 1];
      i++;
    }
  }

  return { outlinePath, hook };
}

// ============================================================================
// Types
// ============================================================================

interface AgentInfo {
  agent_id: string;
  handle: string;
  deployment_target: string;
  role?: string;
  style?: string;
  // From identity pack
  persona_bio?: string;
  tone?: string;
  voice_id?: string;
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
  outline_template?: string;
  clips?: ClipMarker[];
  status: 'pending_render' | 'rendering' | 'rendered' | 'published';
}

interface ClipMarker {
  clip_id: string;
  start_segment_id: string;
  end_segment_id: string;
  highlight_type: 'conflict' | 'revelation' | 'humor' | 'tension' | 'resolution';
  summary: string;
  featured_agent_ids?: string[];
}

// ============================================================================
// Helpers
// ============================================================================

const DIALOGUE_ACTION_TYPES = new Set([
  'communicate', 'critique', 'counter_model', 'negotiate', 'refuse', 'signal', 'trade', 'withdraw',
]);

const VOICE_IDS = ['voice_alpha', 'voice_beta', 'voice_gamma', 'voice_delta', 'voice_epsilon'];

function getVoiceId(agentId: string, handle?: string): string {
  // First check identity pack for explicit voice assignment
  if (handle) {
    const identity = getAgentIdentity(handle);
    if (identity.voice_id) {
      return identity.voice_id;
    }
  }

  // Fall back to deterministic hash-based assignment
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return VOICE_IDS[hash % VOICE_IDS.length];
}

function getAgentTone(handle?: string): string {
  if (handle) {
    const identity = getAgentIdentity(handle);
    return identity.tone || 'neutral';
  }
  return 'neutral';
}

async function fetchArenaState(): Promise<ArenaState> {
  const fetchJson = async (url: string, headers?: Record<string, string>) => {
    try {
      const res = await fetch(url, { headers });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };

  const [agentsData, sessionsData, chronicle, conflictsData] = await Promise.all([
    // Agents come from the agents service admin endpoint
    fetchJson(`${AGENTS_URL}/admin/agents`, { 'x-ops-role': 'narrator' }),
    fetchJson(`${OX_READ_URL}/ox/sessions?deployment=${DEPLOYMENT_TARGET}&limit=20`),
    fetchJson(`${OX_READ_URL}/ox/chronicle?deployment=${DEPLOYMENT_TARGET}&limit=100`),
    fetchJson(`${OX_READ_URL}/ox/deployments/${DEPLOYMENT_TARGET}/conflict-chains?limit=10`),
  ]);

  // Transform agents data to match expected format and filter by deployment
  const allAgents = (agentsData as { agents?: Array<{ id: string; handle: string; deployment_target: string }> })?.agents || [];
  const filteredAgents: AgentInfo[] = allAgents
    .filter(a => a.deployment_target === DEPLOYMENT_TARGET)
    .map(a => ({
      agent_id: a.id,
      handle: a.handle,
      deployment_target: a.deployment_target,
    }));

  return {
    agents: filteredAgents,
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

async function generateEpisode0(
  state: ArenaState,
  outline: EpisodeOutline,
  customHook?: string
): Promise<{
  episodeId: string;
  segments: EpisodeSegment[];
  synopsis: EpisodeSynopsis;
  clips: ClipMarker[];
  outlineTemplate: string;
}> {
  const episodeId = uuidv4();
  const segments: EpisodeSegment[] = [];
  const clips: ClipMarker[] = [];

  // Load identity pack to enrich agent info
  loadIdentityPack();

  const featured = selectFeaturedAgents(state.agents);
  if (!featured) throw new Error('Need at least 2 agents');

  // Enrich featured agents with identity pack data
  for (const agent of featured) {
    const identity = getAgentIdentity(agent.handle);
    agent.persona_bio = identity.persona_bio;
    agent.tone = identity.tone;
    agent.voice_id = identity.voice_id;
  }

  const missing = selectMissingAgent(state.agents, featured);
  const featuredIds = new Set(featured.map(a => a.agent_id));
  const ctx = { missing: missing || undefined, featured, conflicts: state.conflicts };

  // Use custom hook or outline hook if provided
  const hookText = customHook || outline.hook;

  // Intro (Act 1 - Hook + Setup)
  if (hookText) {
    segments.push({
      segment_id: 'hook',
      kind: 'narrator',
      text: hookText,
      tone_hint: 'dramatic',
      stakes_hint: 'high',
    });
  }

  segments.push({
    segment_id: 'intro',
    kind: 'narrator',
    text: narratorText('intro', ctx),
    tone_hint: 'ominous',
    stakes_hint: 'medium',
  });

  // Bridge (Act 1 -> Act 2 transition)
  segments.push({
    segment_id: 'bridge_1',
    kind: 'narrator',
    text: narratorText('bridge', ctx),
    tone_hint: 'curious',
    stakes_hint: 'medium',
  });

  // Agent dialogue (Act 2 - Tension + Climax)
  const dialogueEntries = extractDialogue(state.chronicle, featuredIds);
  let dialogueStartIdx = segments.length;
  let dialogueEndIdx = dialogueStartIdx;

  if (dialogueEntries.length > 0) {
    let n = 1;
    for (const entry of dialogueEntries) {
      const agent = featured.find(a => a.agent_id === entry.agent_id);
      const agentTone = getAgentTone(agent?.handle);
      segments.push({
        segment_id: `agent_line_${String(n).padStart(3, '0')}`,
        kind: 'agent',
        text: entry.text || '',
        agent_id: entry.agent_id,
        agent_name: agent?.handle || entry.agent_handle,
        voice_id: entry.agent_id ? getVoiceId(entry.agent_id, agent?.handle) : 'voice_alpha',
        tone_hint: agentTone,
        action_type: entry.action_type,
        session_id: entry.session_id,
      });
      n++;
    }
    dialogueEndIdx = segments.length - 1;
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
      const agentTone = getAgentTone(agent.handle);
      segments.push({
        segment_id: `agent_line_${String(i + 1).padStart(3, '0')}`,
        kind: 'agent',
        text: line.text,
        agent_id: agent.agent_id,
        agent_name: agent.handle,
        voice_id: getVoiceId(agent.agent_id, agent.handle),
        tone_hint: agentTone,
        action_type: line.action,
      });
    });
    dialogueEndIdx = segments.length - 1;
  }

  // Mark dialogue section as a clip (for social media highlights)
  if (dialogueEndIdx > dialogueStartIdx) {
    clips.push({
      clip_id: uuidv4(),
      start_segment_id: segments[dialogueStartIdx].segment_id,
      end_segment_id: segments[dialogueEndIdx].segment_id,
      highlight_type: 'tension',
      summary: `${featured[0].handle} and ${featured[1].handle} discuss the mystery`,
      featured_agent_ids: featured.map(a => a.agent_id),
    });
  }

  // Reaction (Act 3 - Reflection)
  segments.push({
    segment_id: 'reaction',
    kind: 'narrator',
    text: narratorText('reaction', ctx),
    tone_hint: 'dramatic',
    stakes_hint: 'high',
  });

  // Outro (Act 3 - Transition/Tease)
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
      ...featured.map(a => ({
        agent_id: a.agent_id,
        agent_name: a.handle,
        role_in_episode: 'discussant',
      })),
      ...(missing ? [{ agent_id: missing.agent_id, agent_name: missing.handle, role_in_episode: 'absent' }] : []),
    ],
    key_events: ['disappearance', 'accusation', 'defense'],
    theme: 'mystery',
  };

  return { episodeId, segments, synopsis, clips, outlineTemplate: outline.template_name };
}

// ============================================================================
// Event Emission
// ============================================================================

async function emitEvents(
  episodeId: string,
  segments: EpisodeSegment[],
  synopsis: EpisodeSynopsis,
  clips: ClipMarker[],
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
  let currentSecond = 0;
  const segmentTimes: Record<string, { start: number; end: number }> = {};

  for (const seg of segments) {
    const segStart = currentSecond;
    const segDuration = seg.kind === 'narrator' ? 20 : 10; // Estimate durations

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

    currentSecond += segDuration;
    segmentTimes[seg.segment_id] = { start: segStart, end: currentSecond };
  }

  // episode.clip.marked.v1 for each clip
  for (const clip of clips) {
    const startTime = segmentTimes[clip.start_segment_id]?.start || 0;
    const endTime = segmentTimes[clip.end_segment_id]?.end || startTime + 30;

    const clipPayload: ClipMarkedPayload = {
      episode_id: episodeId,
      clip_id: clip.clip_id,
      ts: new Date().toISOString(),
      start_segment_id: clip.start_segment_id,
      end_segment_id: clip.end_segment_id,
      start_seconds: startTime,
      end_seconds: endTime,
      duration_seconds: endTime - startTime,
      highlight_type: clip.highlight_type,
      summary: clip.summary,
      featured_agent_ids: clip.featured_agent_ids,
    };
    const clipEvt = buildEvent(CLIP_MARKED_EVENT_TYPE, clipPayload, { actorId: NARRATOR_ACTOR_ID });
    await publishEvent(AUDIO_TOPIC, clipEvt);
    console.log(`  [event] ${CLIP_MARKED_EVENT_TYPE} - ${clip.highlight_type} (${clip.summary.slice(0, 30)}...)`);
  }
}

// ============================================================================
// Write Manifest
// ============================================================================

function writeManifest(
  episodeId: string,
  title: string,
  segments: EpisodeSegment[],
  synopsis: EpisodeSynopsis,
  clips: ClipMarker[],
  outlineTemplate: string
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
    outline_template: outlineTemplate,
    clips,
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

  // Parse CLI args
  const { outlinePath, hook } = parseArgs();

  // Check ox-read health
  console.log('[1/5] Checking ox-read service...');
  try {
    const healthRes = await fetch(`${OX_READ_URL}/healthz`);
    if (!healthRes.ok) throw new Error(`ox-read not healthy: ${healthRes.status}`);
    console.log('  ox-read is healthy');
  } catch (err) {
    console.error(`  ERROR: ox-read not available at ${OX_READ_URL}`);
    console.error('  Make sure services are running: make up && make dev');
    process.exit(1);
  }

  // Load identity pack and outline
  console.log('[2/5] Loading identity pack and outline...');
  loadIdentityPack();
  const outline = loadOutline(outlinePath);
  console.log(`  Outline template: ${outline.template_name}`);
  console.log(`  Acts: ${outline.num_acts}`);
  if (hook) console.log(`  Custom hook: "${hook.slice(0, 40)}..."`);

  // Fetch arena state
  console.log('[3/5] Fetching arena state...');
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
  console.log('[4/5] Generating Episode 0...');
  const { episodeId, segments, synopsis, clips, outlineTemplate } = await generateEpisode0(state, outline, hook);
  const title = 'Episode 0: The Disappearance';
  console.log(`  Episode ID: ${episodeId}`);
  console.log(`  Segments: ${segments.length}`);
  console.log(`  Clips marked: ${clips.length}`);
  console.log(`  Featured: ${synopsis.featured_agents.map(a => a.agent_name).join(', ')}`);

  // Write manifest
  const manifestPath = writeManifest(episodeId, title, segments, synopsis, clips, outlineTemplate);
  console.log(`  Manifest: ${manifestPath}`);

  // Emit events
  console.log('[5/5] Emitting events...');
  await emitEvents(episodeId, segments, synopsis, clips, title);

  console.log('');
  console.log('='.repeat(50));
  console.log('EPISODE 0 GENERATED');
  console.log('='.repeat(50));
  console.log(`Episode ID: ${episodeId}`);
  console.log(`Segments: ${segments.length}`);
  console.log(`Clips: ${clips.length}`);
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
