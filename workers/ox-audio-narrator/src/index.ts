/**
 * OX Audio Narrator Worker
 *
 * Generates narration events for the audio pipeline.
 * - Polls ox-read for arena state
 * - Emits narrator.speech.v1 events
 * - Emits agent.dialogue.v1 events (dialogue selection)
 * - Creates episode.created.v1 events
 *
 * The narrator is NOT omniscient - it infers from projections only.
 * All nondeterministic outputs (LLM generation) are snapshotted into events
 * so replay reuses the same outputs.
 */

import Fastify from 'fastify';
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
const AGENTS_URL = process.env.AGENTS_URL || 'http://localhost:4017';
const NARRATOR_PORT = Number(process.env.NARRATOR_PORT || 4120);
const DEPLOYMENT_TARGET = process.env.DEPLOYMENT_TARGET || 'ox-sandbox';

// System actor for narrator events
const NARRATOR_ACTOR_ID = '00000000-0000-0000-0000-000000000001';

const app = Fastify({ logger: true });

// ============================================================================
// Types for ox-read responses
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

// ============================================================================
// Fetch arena state from services
// ============================================================================

async function fetchArenaState(): Promise<ArenaState> {
  const [agentsRes, sessionsRes, chronicleRes, conflictsRes] = await Promise.all([
    // Agents come from the agents service admin endpoint
    fetch(`${AGENTS_URL}/admin/agents`, { headers: { 'x-ops-role': 'narrator' } }),
    fetch(`${OX_READ_URL}/ox/sessions?deployment=${DEPLOYMENT_TARGET}&limit=20`),
    fetch(`${OX_READ_URL}/ox/chronicle?deployment=${DEPLOYMENT_TARGET}&limit=100`),
    fetch(`${OX_READ_URL}/ox/deployments/${DEPLOYMENT_TARGET}/conflict-chains?limit=10`),
  ]);

  // Transform agents data and filter by deployment
  const allAgents = agentsRes.ok
    ? ((await agentsRes.json()) as { agents?: Array<{ id: string; handle: string; deployment_target: string }> }).agents || []
    : [];
  const agents: AgentInfo[] = allAgents
    .filter(a => a.deployment_target === DEPLOYMENT_TARGET)
    .map(a => ({
      agent_id: a.id,
      handle: a.handle,
      deployment_target: a.deployment_target,
    }));

  const sessions = sessionsRes.ok ? ((await sessionsRes.json()) as { sessions?: SessionInfo[] }).sessions || [] : [];
  const chronicle = chronicleRes.ok ? ((await chronicleRes.json()) as ChronicleEntry[]) : [];
  const conflicts = conflictsRes.ok ? ((await conflictsRes.json()) as { conflict_chains?: unknown[] }).conflict_chains || [] : [];

  return { agents, sessions, chronicle, conflicts };
}

// ============================================================================
// Dialogue-eligible action types
// ============================================================================

const DIALOGUE_ACTION_TYPES = new Set([
  'communicate',
  'critique',
  'counter_model',
  'negotiate',
  'refuse',
  'signal',
  'trade',
  'withdraw',
]);

// ============================================================================
// Voice assignment (deterministic based on agent_id hash)
// ============================================================================

const VOICE_IDS = ['voice_alpha', 'voice_beta', 'voice_gamma', 'voice_delta', 'voice_epsilon'];

function getVoiceId(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return VOICE_IDS[hash % VOICE_IDS.length];
}

// ============================================================================
// Episode 0 Generation - "The Disappearance" premise
// ============================================================================

interface EpisodeSegment {
  segment_id: string;
  kind: 'narrator' | 'agent';
  text: string;
  agent_id?: string;
  agent_name?: string;
  tone_hint?: string;
  stakes_hint?: string;
  action_type?: string;
  session_id?: string;
}

function selectFeaturedAgents(agents: AgentInfo[]): [AgentInfo, AgentInfo] | null {
  // Pick two agents: prefer those with different styles or roles
  const sortedAgents = [...agents].sort((a, b) => {
    // Prioritize agents with provocateur/critic roles for drama
    const aPriority = (a.style === 'provocateur' || a.style === 'critic') ? 1 : 0;
    const bPriority = (b.style === 'provocateur' || b.style === 'critic') ? 1 : 0;
    return bPriority - aPriority;
  });

  if (sortedAgents.length < 2) return null;
  return [sortedAgents[0], sortedAgents[1]];
}

function selectMissingAgent(agents: AgentInfo[], featured: AgentInfo[]): AgentInfo | null {
  // Select an agent that is NOT featured - this is the "disappeared" agent (SERA concept)
  const featuredIds = new Set(featured.map(a => a.agent_id));
  const others = agents.filter(a => !featuredIds.has(a.agent_id));
  return others.length > 0 ? others[0] : null;
}

function extractDialogueFromChronicle(
  chronicle: ChronicleEntry[],
  featuredAgentIds: Set<string>,
): ChronicleEntry[] {
  return chronicle
    .filter(entry =>
      entry.agent_id &&
      featuredAgentIds.has(entry.agent_id) &&
      entry.action_type &&
      DIALOGUE_ACTION_TYPES.has(entry.action_type) &&
      entry.text
    )
    .slice(0, 10); // Limit to 10 dialogue lines
}

function generateNarratorText(
  segment: 'intro' | 'bridge' | 'reaction' | 'outro',
  context: {
    missingAgent?: AgentInfo;
    featuredAgents: AgentInfo[];
    conflicts: unknown[];
  }
): string {
  const { missingAgent, featuredAgents, conflicts } = context;
  const agent1 = featuredAgents[0]?.handle || 'Agent Alpha';
  const agent2 = featuredAgents[1]?.handle || 'Agent Beta';
  const missing = missingAgent?.handle || 'an agent';

  switch (segment) {
    case 'intro':
      return `Welcome to the OX Arena. Tonight, we observe an unusual silence. ${missing} has gone dark. ` +
        `No transmissions. No activity. In a world where every action is observed, disappearance speaks volumes.`;

    case 'bridge':
      return `Two agents remain in the spotlight: ${agent1} and ${agent2}. ` +
        `What do they know? What do they suspect? Let us listen to their exchange.`;

    case 'reaction': {
      const hasConflicts = conflicts.length > 0;
      return hasConflicts
        ? `The tension is palpable. Accusations fly. But in the arena, words have weight. Every statement costs capacity. ` +
          `These agents are spending precious resources to make their positions known.`
        : `The exchange continues. In this arena, communication is not free. Each word, each gesture, depletes capacity. ` +
          `Yet they persist. The question of ${missing}'s absence hangs heavy.`;
    }

    case 'outro':
      return `And so the mystery deepens. ${missing} remains silent. ${agent1} and ${agent2} have spoken their piece. ` +
        `But in the OX Arena, nothing is ever truly resolved. Until next time, observers. Stay watchful.`;

    default:
      return '';
  }
}

async function generateEpisode0(arenaState: ArenaState): Promise<{
  episodeId: string;
  segments: EpisodeSegment[];
  synopsis: EpisodeSynopsis;
}> {
  const episodeId = uuidv4();
  const segments: EpisodeSegment[] = [];

  // Select agents
  const featured = selectFeaturedAgents(arenaState.agents);
  if (!featured) {
    throw new Error('Not enough agents for episode generation (need at least 2)');
  }

  const missingAgent = selectMissingAgent(arenaState.agents, featured);
  const featuredAgentIds = new Set(featured.map(a => a.agent_id));

  // Context for narrator
  const narratorContext = {
    missingAgent: missingAgent || undefined,
    featuredAgents: featured,
    conflicts: arenaState.conflicts,
  };

  // 1. Intro
  segments.push({
    segment_id: 'intro',
    kind: 'narrator',
    text: generateNarratorText('intro', narratorContext),
    tone_hint: 'ominous',
    stakes_hint: 'medium',
  });

  // 2. Bridge to agents
  segments.push({
    segment_id: 'bridge_1',
    kind: 'narrator',
    text: generateNarratorText('bridge', narratorContext),
    tone_hint: 'curious',
    stakes_hint: 'medium',
  });

  // 3. Agent dialogue (extracted from chronicle or generated)
  const dialogueEntries = extractDialogueFromChronicle(arenaState.chronicle, featuredAgentIds);

  if (dialogueEntries.length > 0) {
    let lineNum = 1;
    for (const entry of dialogueEntries) {
      const agent = featured.find(a => a.agent_id === entry.agent_id);
      segments.push({
        segment_id: `agent_line_${String(lineNum).padStart(3, '0')}`,
        kind: 'agent',
        text: entry.text || '',
        agent_id: entry.agent_id,
        agent_name: agent?.handle || entry.agent_handle,
        action_type: entry.action_type,
        session_id: entry.session_id,
      });
      lineNum++;
    }
  } else {
    // Generate placeholder dialogue if no chronicle entries
    segments.push({
      segment_id: 'agent_line_001',
      kind: 'agent',
      text: `I have observed the silence. Something is wrong in sector seven.`,
      agent_id: featured[0].agent_id,
      agent_name: featured[0].handle,
      action_type: 'communicate',
    });
    segments.push({
      segment_id: 'agent_line_002',
      kind: 'agent',
      text: `Wrong? Or perhaps... planned. Not all absences are accidental.`,
      agent_id: featured[1].agent_id,
      agent_name: featured[1].handle,
      action_type: 'communicate',
    });
    segments.push({
      segment_id: 'agent_line_003',
      kind: 'agent',
      text: `You suspect sabotage? That is a serious accusation.`,
      agent_id: featured[0].agent_id,
      agent_name: featured[0].handle,
      action_type: 'critique',
    });
    segments.push({
      segment_id: 'agent_line_004',
      kind: 'agent',
      text: `I suspect nothing. I merely observe patterns. The data speaks.`,
      agent_id: featured[1].agent_id,
      agent_name: featured[1].handle,
      action_type: 'counter_model',
    });
  }

  // 4. Narrator reaction
  segments.push({
    segment_id: 'reaction',
    kind: 'narrator',
    text: generateNarratorText('reaction', narratorContext),
    tone_hint: 'dramatic',
    stakes_hint: 'high',
  });

  // 5. Outro
  segments.push({
    segment_id: 'outro',
    kind: 'narrator',
    text: generateNarratorText('outro', narratorContext),
    tone_hint: 'reflective',
    stakes_hint: 'medium',
  });

  // Build synopsis
  const synopsis: EpisodeSynopsis = {
    premise: `${missingAgent?.handle || 'An agent'} has gone silent. Two agents discuss what this means.`,
    featured_agents: featured.map(a => ({
      agent_id: a.agent_id,
      agent_name: a.handle,
      role_in_episode: 'discussant',
    })),
    key_events: ['disappearance', 'accusation', 'defense'],
    theme: 'mystery',
  };

  if (missingAgent) {
    synopsis.featured_agents.push({
      agent_id: missingAgent.agent_id,
      agent_name: missingAgent.handle,
      role_in_episode: 'absent',
    });
  }

  return { episodeId, segments, synopsis };
}

// ============================================================================
// Emit events for an episode
// ============================================================================

async function emitEpisodeEvents(
  episodeId: string,
  segments: EpisodeSegment[],
  synopsis: EpisodeSynopsis,
  title: string
): Promise<void> {
  const ts = new Date().toISOString();

  // 1. Emit episode.created.v1
  const createdPayload: EpisodeCreatedPayload = {
    episode_id: episodeId,
    deployment_target: DEPLOYMENT_TARGET,
    ts,
    title,
    synopsis_json: synopsis,
    duration_seconds: segments.length * 30, // Estimate 30s per segment
  };

  const createdEvent = buildEvent(EPISODE_CREATED_EVENT_TYPE, createdPayload, {
    actorId: NARRATOR_ACTOR_ID,
  });
  await publishEvent(AUDIO_TOPIC, createdEvent);
  app.log.info({ episodeId, eventType: EPISODE_CREATED_EVENT_TYPE }, 'Episode created event emitted');

  // 2. Emit narrator.speech.v1 and agent.dialogue.v1 for each segment
  for (const segment of segments) {
    if (segment.kind === 'narrator') {
      const speechPayload: NarratorSpeechPayload = {
        episode_id: episodeId,
        deployment_target: DEPLOYMENT_TARGET,
        ts: new Date().toISOString(),
        segment_id: segment.segment_id,
        text: segment.text,
        tone_hint: segment.tone_hint as NarratorSpeechPayload['tone_hint'],
        stakes_hint: segment.stakes_hint as NarratorSpeechPayload['stakes_hint'],
        references: undefined,
      };

      const speechEvent = buildEvent(NARRATOR_SPEECH_EVENT_TYPE, speechPayload, {
        actorId: NARRATOR_ACTOR_ID,
      });
      await publishEvent(AUDIO_TOPIC, speechEvent);
      app.log.info({ episodeId, segmentId: segment.segment_id }, 'Narrator speech event emitted');
    } else if (segment.kind === 'agent' && segment.agent_id) {
      const dialoguePayload: AgentDialoguePayload = {
        episode_id: episodeId,
        deployment_target: DEPLOYMENT_TARGET,
        ts: new Date().toISOString(),
        segment_id: segment.segment_id,
        agent_id: segment.agent_id,
        agent_name: segment.agent_name,
        voice_id: getVoiceId(segment.agent_id),
        text: segment.text,
        action_type: segment.action_type,
        session_id: segment.session_id,
      };

      const dialogueEvent = buildEvent(AGENT_DIALOGUE_EVENT_TYPE, dialoguePayload, {
        actorId: segment.agent_id,
      });
      await publishEvent(AUDIO_TOPIC, dialogueEvent);
      app.log.info({ episodeId, segmentId: segment.segment_id, agentId: segment.agent_id }, 'Agent dialogue event emitted');
    }
  }
}

// ============================================================================
// HTTP Endpoints
// ============================================================================

app.get('/healthz', async () => ({ ok: true, service: 'ox-audio-narrator' }));

app.get('/status', async () => {
  const state = await fetchArenaState();
  return {
    ok: true,
    arena: {
      agents: state.agents.length,
      sessions: state.sessions.length,
      chronicle_entries: state.chronicle.length,
      conflicts: state.conflicts.length,
    },
  };
});

app.post('/audio/episode0/generate', async (_request, reply) => {
  try {
    app.log.info('Generating Episode 0...');

    // Fetch current arena state
    const arenaState = await fetchArenaState();

    if (arenaState.agents.length < 2) {
      return reply.status(400).send({
        error: 'Not enough agents',
        detail: 'Need at least 2 agents in the arena. Run `make seed-watchable` first.',
      });
    }

    // Generate episode structure
    const { episodeId, segments, synopsis } = await generateEpisode0(arenaState);

    // Emit all events
    await emitEpisodeEvents(episodeId, segments, synopsis, 'Episode 0: The Disappearance');

    return {
      ok: true,
      episode_id: episodeId,
      title: 'Episode 0: The Disappearance',
      segment_count: segments.length,
      segments: segments.map(s => ({
        segment_id: s.segment_id,
        kind: s.kind,
        agent_name: s.agent_name,
        text_preview: s.text.slice(0, 50) + '...',
      })),
      synopsis,
      next_step: 'Events emitted to events.ox-audio.v1. Run the renderer to produce audio.',
    };
  } catch (err) {
    app.log.error({ err }, 'Failed to generate episode');
    return reply.status(500).send({
      error: 'Episode generation failed',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// ============================================================================
// Start
// ============================================================================

const start = async () => {
  try {
    await app.listen({ port: NARRATOR_PORT, host: '0.0.0.0' });
    app.log.info(`OX Audio Narrator running on port ${NARRATOR_PORT}`);
    app.log.info(`POST /audio/episode0/generate to create Episode 0`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
