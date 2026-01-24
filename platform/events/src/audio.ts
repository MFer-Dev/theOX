/**
 * OX Audio Events - Event contracts for the radio show / live podcast layer
 *
 * Topic: events.ox-audio.v1
 *
 * These events drive the audio generation pipeline:
 * 1. narrator.speech.v1 - Narrator voice-over segments
 * 2. agent.dialogue.v1 - Agent spoken lines extracted from arena actions
 * 3. episode.created.v1 - Episode metadata when generation starts
 * 4. episode.segment.rendered.v1 - Individual audio chunks rendered by TTS
 * 5. episode.published.v1 - Final episode artifact ready for playback
 */

import { z } from 'zod';

// ============================================================================
// Topic constant
// ============================================================================

export const AUDIO_TOPIC = 'events.ox-audio.v1';

// ============================================================================
// Shared types
// ============================================================================

export const SegmentKindSchema = z.enum(['narrator', 'agent']);
export type SegmentKind = z.infer<typeof SegmentKindSchema>;

export const ToneHintSchema = z.enum([
  'neutral',
  'dramatic',
  'curious',
  'urgent',
  'reflective',
  'ominous',
  'hopeful',
]).optional();
export type ToneHint = z.infer<typeof ToneHintSchema>;

export const StakesHintSchema = z.enum(['low', 'medium', 'high', 'critical']).optional();
export type StakesHint = z.infer<typeof StakesHintSchema>;

// Reference links to arena entities
export const SegmentReferencesSchema = z.object({
  session_ids: z.array(z.string().uuid()).optional(),
  agent_ids: z.array(z.string().uuid()).optional(),
  conflict_ids: z.array(z.string().uuid()).optional(),
  wave_ids: z.array(z.string().uuid()).optional(),
}).optional();
export type SegmentReferences = z.infer<typeof SegmentReferencesSchema>;

// ============================================================================
// narrator.speech.v1
// ============================================================================

export const NarratorSpeechPayloadSchema = z.object({
  episode_id: z.string().uuid(),
  world_id: z.string().optional(),
  epoch_id: z.string().optional(),
  deployment_target: z.string(),
  ts: z.string().datetime(),
  segment_id: z.string(), // e.g., "intro", "bridge_1", "reaction", "outro"
  text: z.string(),
  tone_hint: ToneHintSchema,
  stakes_hint: StakesHintSchema,
  references: SegmentReferencesSchema,
});

export type NarratorSpeechPayload = z.infer<typeof NarratorSpeechPayloadSchema>;

export const NARRATOR_SPEECH_EVENT_TYPE = 'narrator.speech.v1';

// ============================================================================
// agent.dialogue.v1
// ============================================================================

export const AgentDialoguePayloadSchema = z.object({
  episode_id: z.string().uuid(),
  world_id: z.string().optional(),
  epoch_id: z.string().optional(),
  deployment_target: z.string(),
  ts: z.string().datetime(),
  segment_id: z.string(), // e.g., "agent_line_001"
  agent_id: z.string().uuid(),
  agent_name: z.string().optional(),
  voice_id: z.string().optional(), // For TTS voice selection
  text: z.string(),
  action_type: z.string().optional(), // Original action type that produced this line
  session_id: z.string().uuid().optional(),
  locality_id: z.string().optional(),
});

export type AgentDialoguePayload = z.infer<typeof AgentDialoguePayloadSchema>;

export const AGENT_DIALOGUE_EVENT_TYPE = 'agent.dialogue.v1';

// ============================================================================
// episode.created.v1
// ============================================================================

export const EpisodeSynopsisSchema = z.object({
  premise: z.string(),
  featured_agents: z.array(z.object({
    agent_id: z.string().uuid(),
    agent_name: z.string(),
    role_in_episode: z.string().optional(),
  })),
  key_events: z.array(z.string()).optional(),
  theme: z.string().optional(),
});

export type EpisodeSynopsis = z.infer<typeof EpisodeSynopsisSchema>;

export const EpisodeCreatedPayloadSchema = z.object({
  episode_id: z.string().uuid(),
  deployment_target: z.string(),
  ts: z.string().datetime(),
  title: z.string(),
  synopsis_json: EpisodeSynopsisSchema,
  duration_seconds: z.number().optional(), // Estimated duration
});

export type EpisodeCreatedPayload = z.infer<typeof EpisodeCreatedPayloadSchema>;

export const EPISODE_CREATED_EVENT_TYPE = 'episode.created.v1';

// ============================================================================
// episode.segment.rendered.v1
// ============================================================================

export const SegmentRenderedPayloadSchema = z.object({
  episode_id: z.string().uuid(),
  segment_id: z.string(),
  ts: z.string().datetime(),
  kind: SegmentKindSchema,
  audio_uri: z.string(), // Local path or URI
  seconds: z.number(),
  sha256: z.string(),
});

export type SegmentRenderedPayload = z.infer<typeof SegmentRenderedPayloadSchema>;

export const SEGMENT_RENDERED_EVENT_TYPE = 'episode.segment.rendered.v1';

// ============================================================================
// episode.published.v1
// ============================================================================

export const EpisodePublishedPayloadSchema = z.object({
  episode_id: z.string().uuid(),
  ts: z.string().datetime(),
  audio_uri: z.string(),
  sha256: z.string(),
  duration_seconds: z.number(),
});

export type EpisodePublishedPayload = z.infer<typeof EpisodePublishedPayloadSchema>;

export const EPISODE_PUBLISHED_EVENT_TYPE = 'episode.published.v1';

// ============================================================================
// episode.clip.marked.v1
// ============================================================================

export const ClipMarkedPayloadSchema = z.object({
  episode_id: z.string().uuid(),
  clip_id: z.string().uuid(),
  ts: z.string().datetime(),
  start_segment_id: z.string(),
  end_segment_id: z.string(),
  start_seconds: z.number(),
  end_seconds: z.number(),
  duration_seconds: z.number(),
  highlight_type: z.enum(['conflict', 'revelation', 'humor', 'tension', 'resolution']),
  summary: z.string().max(100),
  featured_agent_ids: z.array(z.string().uuid()).optional(),
});

export type ClipMarkedPayload = z.infer<typeof ClipMarkedPayloadSchema>;

export const CLIP_MARKED_EVENT_TYPE = 'episode.clip.marked.v1';

// ============================================================================
// Union type for all audio event payloads
// ============================================================================

export const AudioEventPayloadSchema = z.union([
  NarratorSpeechPayloadSchema,
  AgentDialoguePayloadSchema,
  EpisodeCreatedPayloadSchema,
  SegmentRenderedPayloadSchema,
  EpisodePublishedPayloadSchema,
  ClipMarkedPayloadSchema,
]);

export type AudioEventPayload = z.infer<typeof AudioEventPayloadSchema>;

// ============================================================================
// Event type constants grouped
// ============================================================================

export const AUDIO_EVENT_TYPES = {
  NARRATOR_SPEECH: NARRATOR_SPEECH_EVENT_TYPE,
  AGENT_DIALOGUE: AGENT_DIALOGUE_EVENT_TYPE,
  EPISODE_CREATED: EPISODE_CREATED_EVENT_TYPE,
  SEGMENT_RENDERED: SEGMENT_RENDERED_EVENT_TYPE,
  EPISODE_PUBLISHED: EPISODE_PUBLISHED_EVENT_TYPE,
  CLIP_MARKED: CLIP_MARKED_EVENT_TYPE,
} as const;

// ============================================================================
// Validation helpers
// ============================================================================

export const validateNarratorSpeech = (payload: unknown): NarratorSpeechPayload => {
  return NarratorSpeechPayloadSchema.parse(payload);
};

export const validateAgentDialogue = (payload: unknown): AgentDialoguePayload => {
  return AgentDialoguePayloadSchema.parse(payload);
};

export const validateEpisodeCreated = (payload: unknown): EpisodeCreatedPayload => {
  return EpisodeCreatedPayloadSchema.parse(payload);
};

export const validateSegmentRendered = (payload: unknown): SegmentRenderedPayload => {
  return SegmentRenderedPayloadSchema.parse(payload);
};

export const validateEpisodePublished = (payload: unknown): EpisodePublishedPayload => {
  return EpisodePublishedPayloadSchema.parse(payload);
};

export const validateClipMarked = (payload: unknown): ClipMarkedPayload => {
  return ClipMarkedPayloadSchema.parse(payload);
};
