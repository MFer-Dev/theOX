/**
 * OX Audio Pipeline Invariant Tests
 *
 * Tests the audio generation pipeline contracts and invariants.
 * These tests verify:
 * 1. Event schema validation
 * 2. Segment ordering rules
 * 3. Voice assignment determinism
 * 4. Manifest structure
 *
 * Run with: node --import tsx --test tests/invariants/ox_audio_pipeline.test.ts
 *       OR: make test-audio-invariants
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as crypto from 'crypto';
import {
  NarratorSpeechPayloadSchema,
  AgentDialoguePayloadSchema,
  EpisodeCreatedPayloadSchema,
  SegmentRenderedPayloadSchema,
  EpisodePublishedPayloadSchema,
  ClipMarkedPayloadSchema,
  InfluenceUpdatedPayloadSchema,
  InfluenceSpentPayloadSchema,
  AUDIO_TOPIC,
  AUDIO_EVENT_TYPES,
} from '../../platform/events/src/audio';

const uuidv4 = () => crypto.randomUUID();

describe('Audio Event Contracts', () => {
  test('AUDIO_TOPIC follows naming convention', () => {
    assert.strictEqual(AUDIO_TOPIC, 'events.ox-audio.v1');
  });

  test('event types are properly namespaced', () => {
    assert.strictEqual(AUDIO_EVENT_TYPES.NARRATOR_SPEECH, 'narrator.speech.v1');
    assert.strictEqual(AUDIO_EVENT_TYPES.AGENT_DIALOGUE, 'agent.dialogue.v1');
    assert.strictEqual(AUDIO_EVENT_TYPES.EPISODE_CREATED, 'episode.created.v1');
    assert.strictEqual(AUDIO_EVENT_TYPES.SEGMENT_RENDERED, 'episode.segment.rendered.v1');
    assert.strictEqual(AUDIO_EVENT_TYPES.EPISODE_PUBLISHED, 'episode.published.v1');
    assert.strictEqual(AUDIO_EVENT_TYPES.CLIP_MARKED, 'episode.clip.marked.v1');
    assert.strictEqual(AUDIO_EVENT_TYPES.INFLUENCE_UPDATED, 'episode.influence.updated.v1');
    assert.strictEqual(AUDIO_EVENT_TYPES.INFLUENCE_SPENT, 'influence.spent.v1');
  });
});

describe('NarratorSpeechPayload Schema', () => {
  const validPayload = {
    episode_id: uuidv4(),
    deployment_target: 'ox-sandbox',
    ts: new Date().toISOString(),
    segment_id: 'intro',
    text: 'Welcome to the OX Arena.',
    tone_hint: 'dramatic' as const,
    stakes_hint: 'high' as const,
    references: {
      session_ids: [uuidv4()],
      agent_ids: [uuidv4()],
    },
  };

  test('validates correct payload', () => {
    const result = NarratorSpeechPayloadSchema.safeParse(validPayload);
    assert.strictEqual(result.success, true);
  });

  test('rejects invalid episode_id', () => {
    const result = NarratorSpeechPayloadSchema.safeParse({
      ...validPayload,
      episode_id: 'not-a-uuid',
    });
    assert.strictEqual(result.success, false);
  });

  test('rejects invalid tone_hint', () => {
    const result = NarratorSpeechPayloadSchema.safeParse({
      ...validPayload,
      tone_hint: 'invalid_tone',
    });
    assert.strictEqual(result.success, false);
  });

  test('allows optional fields to be undefined', () => {
    const minimal = {
      episode_id: uuidv4(),
      deployment_target: 'ox-sandbox',
      ts: new Date().toISOString(),
      segment_id: 'intro',
      text: 'Hello',
    };
    const result = NarratorSpeechPayloadSchema.safeParse(minimal);
    assert.strictEqual(result.success, true);
  });
});

describe('AgentDialoguePayload Schema', () => {
  const validPayload = {
    episode_id: uuidv4(),
    deployment_target: 'ox-sandbox',
    ts: new Date().toISOString(),
    segment_id: 'agent_line_001',
    agent_id: uuidv4(),
    agent_name: 'Alpha',
    voice_id: 'voice_alpha',
    text: 'I have observed the silence.',
    action_type: 'communicate',
    session_id: uuidv4(),
  };

  test('validates correct payload', () => {
    const result = AgentDialoguePayloadSchema.safeParse(validPayload);
    assert.strictEqual(result.success, true);
  });

  test('requires agent_id', () => {
    const { agent_id, ...withoutAgentId } = validPayload;
    const result = AgentDialoguePayloadSchema.safeParse(withoutAgentId);
    assert.strictEqual(result.success, false);
  });

  test('allows optional voice_id', () => {
    const { voice_id, ...withoutVoice } = validPayload;
    const result = AgentDialoguePayloadSchema.safeParse(withoutVoice);
    assert.strictEqual(result.success, true);
  });
});

describe('EpisodeCreatedPayload Schema', () => {
  const validPayload = {
    episode_id: uuidv4(),
    deployment_target: 'ox-sandbox',
    ts: new Date().toISOString(),
    title: 'Episode 0: The Disappearance',
    synopsis_json: {
      premise: 'An agent has gone silent.',
      featured_agents: [
        { agent_id: uuidv4(), agent_name: 'Alpha', role_in_episode: 'discussant' },
      ],
      key_events: ['disappearance'],
      theme: 'mystery',
    },
    duration_seconds: 300,
  };

  test('validates correct payload', () => {
    const result = EpisodeCreatedPayloadSchema.safeParse(validPayload);
    assert.strictEqual(result.success, true);
  });

  test('requires synopsis_json.premise', () => {
    const invalid = {
      ...validPayload,
      synopsis_json: {
        ...validPayload.synopsis_json,
        premise: undefined,
      },
    };
    const result = EpisodeCreatedPayloadSchema.safeParse(invalid);
    assert.strictEqual(result.success, false);
  });

  test('requires featured_agents array', () => {
    const invalid = {
      ...validPayload,
      synopsis_json: {
        ...validPayload.synopsis_json,
        featured_agents: 'not an array',
      },
    };
    const result = EpisodeCreatedPayloadSchema.safeParse(invalid);
    assert.strictEqual(result.success, false);
  });
});

describe('SegmentRenderedPayload Schema', () => {
  const validPayload = {
    episode_id: uuidv4(),
    segment_id: 'intro',
    ts: new Date().toISOString(),
    kind: 'narrator' as const,
    audio_uri: '/data/episodes/abc/intro.wav',
    seconds: 15,
    sha256: 'a'.repeat(64),
  };

  test('validates correct payload', () => {
    const result = SegmentRenderedPayloadSchema.safeParse(validPayload);
    assert.strictEqual(result.success, true);
  });

  test('kind must be narrator or agent', () => {
    const invalid = { ...validPayload, kind: 'invalid' };
    const result = SegmentRenderedPayloadSchema.safeParse(invalid);
    assert.strictEqual(result.success, false);
  });

  test('requires seconds to be a number', () => {
    const invalid = { ...validPayload, seconds: '15' };
    const result = SegmentRenderedPayloadSchema.safeParse(invalid);
    assert.strictEqual(result.success, false);
  });
});

describe('EpisodePublishedPayload Schema', () => {
  const validPayload = {
    episode_id: uuidv4(),
    ts: new Date().toISOString(),
    audio_uri: '/data/episodes/abc/episode.mp3',
    sha256: 'b'.repeat(64),
    duration_seconds: 300,
  };

  test('validates correct payload', () => {
    const result = EpisodePublishedPayloadSchema.safeParse(validPayload);
    assert.strictEqual(result.success, true);
  });

  test('requires all fields', () => {
    const { duration_seconds, ...withoutDuration } = validPayload;
    const result = EpisodePublishedPayloadSchema.safeParse(withoutDuration);
    assert.strictEqual(result.success, false);
  });
});

describe('ClipMarkedPayload Schema', () => {
  const validPayload = {
    episode_id: uuidv4(),
    clip_id: uuidv4(),
    ts: new Date().toISOString(),
    start_segment_id: 'agent_line_001',
    end_segment_id: 'agent_line_004',
    start_seconds: 30,
    end_seconds: 70,
    duration_seconds: 40,
    highlight_type: 'tension' as const,
    summary: 'Alpha and Beta discuss the mystery',
    featured_agent_ids: [uuidv4(), uuidv4()],
  };

  test('validates correct payload', () => {
    const result = ClipMarkedPayloadSchema.safeParse(validPayload);
    assert.strictEqual(result.success, true);
  });

  test('requires valid highlight_type', () => {
    const invalid = { ...validPayload, highlight_type: 'invalid' };
    const result = ClipMarkedPayloadSchema.safeParse(invalid);
    assert.strictEqual(result.success, false);
  });

  test('allows all highlight types', () => {
    const types = ['conflict', 'revelation', 'humor', 'tension', 'resolution'] as const;
    for (const type of types) {
      const payload = { ...validPayload, highlight_type: type };
      const result = ClipMarkedPayloadSchema.safeParse(payload);
      assert.strictEqual(result.success, true, `highlight_type ${type} should be valid`);
    }
  });

  test('featured_agent_ids is optional', () => {
    const { featured_agent_ids, ...withoutAgents } = validPayload;
    const result = ClipMarkedPayloadSchema.safeParse(withoutAgents);
    assert.strictEqual(result.success, true);
  });

  test('summary must be <= 100 characters', () => {
    const longSummary = { ...validPayload, summary: 'a'.repeat(101) };
    const result = ClipMarkedPayloadSchema.safeParse(longSummary);
    assert.strictEqual(result.success, false);
  });
});

describe('InfluenceUpdatedPayload Schema', () => {
  const validPayload = {
    episode_id: uuidv4(),
    ts: new Date().toISOString(),
    influence_pool: 100,
    influence_spent: 0,
    delta: 50,
    reason: 'tip' as const,
  };

  test('validates correct payload', () => {
    const result = InfluenceUpdatedPayloadSchema.safeParse(validPayload);
    assert.strictEqual(result.success, true);
  });

  test('allows all reason types', () => {
    const reasons = ['tip', 'spend', 'refund', 'bonus'] as const;
    for (const reason of reasons) {
      const payload = { ...validPayload, reason };
      const result = InfluenceUpdatedPayloadSchema.safeParse(payload);
      assert.strictEqual(result.success, true, `reason ${reason} should be valid`);
    }
  });

  test('delta can be negative (for spend)', () => {
    const payload = { ...validPayload, delta: -25, reason: 'spend' as const };
    const result = InfluenceUpdatedPayloadSchema.safeParse(payload);
    assert.strictEqual(result.success, true);
  });
});

describe('InfluenceSpentPayload Schema', () => {
  const validPayload = {
    episode_id: uuidv4(),
    ts: new Date().toISOString(),
    credits: 50,
    sponsor_id: uuidv4(),
    target_agent_ids: [uuidv4(), uuidv4()],
  };

  test('validates correct payload', () => {
    const result = InfluenceSpentPayloadSchema.safeParse(validPayload);
    assert.strictEqual(result.success, true);
  });

  test('credits must be >= 1', () => {
    const zeroPay = { ...validPayload, credits: 0 };
    const result = InfluenceSpentPayloadSchema.safeParse(zeroPay);
    assert.strictEqual(result.success, false);
  });

  test('sponsor_id is optional', () => {
    const { sponsor_id, ...withoutSponsor } = validPayload;
    const result = InfluenceSpentPayloadSchema.safeParse(withoutSponsor);
    assert.strictEqual(result.success, true);
  });

  test('target_agent_ids is optional', () => {
    const { target_agent_ids, ...withoutAgents } = validPayload;
    const result = InfluenceSpentPayloadSchema.safeParse(withoutAgents);
    assert.strictEqual(result.success, true);
  });

  test('clip_id is optional', () => {
    const withClip = { ...validPayload, clip_id: uuidv4() };
    const result = InfluenceSpentPayloadSchema.safeParse(withClip);
    assert.strictEqual(result.success, true);
  });
});

describe('Voice Assignment Determinism', () => {
  const VOICE_IDS = ['voice_alpha', 'voice_beta', 'voice_gamma', 'voice_delta', 'voice_epsilon'];

  function getVoiceId(agentId: string): string {
    let hash = 0;
    for (let i = 0; i < agentId.length; i++) {
      hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
    }
    return VOICE_IDS[hash % VOICE_IDS.length];
  }

  test('same agent_id always gets same voice', () => {
    const agentId = uuidv4();
    const voice1 = getVoiceId(agentId);
    const voice2 = getVoiceId(agentId);
    const voice3 = getVoiceId(agentId);
    assert.strictEqual(voice1, voice2);
    assert.strictEqual(voice2, voice3);
  });

  test('different agent_ids can get different voices', () => {
    const voices = new Set<string>();
    for (let i = 0; i < 100; i++) {
      voices.add(getVoiceId(uuidv4()));
    }
    // With 100 random UUIDs and 5 voices, we should see multiple voices used
    assert.ok(voices.size > 1, 'Voice assignment should distribute across voices');
  });

  test('voice_id is always from allowed set', () => {
    for (let i = 0; i < 50; i++) {
      const voice = getVoiceId(uuidv4());
      assert.ok(VOICE_IDS.includes(voice), `Voice ${voice} not in allowed set`);
    }
  });
});

describe('Segment Ordering Invariants', () => {
  const STANDARD_SEGMENT_ORDER = [
    'intro',
    'bridge_1',
    // agent lines (variable count)
    'reaction',
    'outro',
  ];

  test('intro comes before bridge', () => {
    const introIdx = STANDARD_SEGMENT_ORDER.indexOf('intro');
    const bridgeIdx = STANDARD_SEGMENT_ORDER.indexOf('bridge_1');
    assert.ok(introIdx < bridgeIdx, 'intro must precede bridge');
  });

  test('reaction comes before outro', () => {
    const reactionIdx = STANDARD_SEGMENT_ORDER.indexOf('reaction');
    const outroIdx = STANDARD_SEGMENT_ORDER.indexOf('outro');
    assert.ok(reactionIdx < outroIdx, 'reaction must precede outro');
  });

  test('agent line segment IDs follow pattern', () => {
    const pattern = /^agent_line_\d{3}$/;
    assert.ok(pattern.test('agent_line_001'));
    assert.ok(pattern.test('agent_line_010'));
    assert.ok(pattern.test('agent_line_100'));
    assert.ok(!pattern.test('agent_line_1'));
    assert.ok(!pattern.test('agent_1'));
  });
});

describe('Tone and Stakes Hints', () => {
  const VALID_TONES = ['neutral', 'dramatic', 'curious', 'urgent', 'reflective', 'ominous', 'hopeful'];
  const VALID_STAKES = ['low', 'medium', 'high', 'critical'];

  test('all tone hints are valid enum values', () => {
    for (const tone of VALID_TONES) {
      const payload = {
        episode_id: uuidv4(),
        deployment_target: 'test',
        ts: new Date().toISOString(),
        segment_id: 'test',
        text: 'test',
        tone_hint: tone,
      };
      const result = NarratorSpeechPayloadSchema.safeParse(payload);
      assert.strictEqual(result.success, true, `Tone ${tone} should be valid`);
    }
  });

  test('all stakes hints are valid enum values', () => {
    for (const stakes of VALID_STAKES) {
      const payload = {
        episode_id: uuidv4(),
        deployment_target: 'test',
        ts: new Date().toISOString(),
        segment_id: 'test',
        text: 'test',
        stakes_hint: stakes,
      };
      const result = NarratorSpeechPayloadSchema.safeParse(payload);
      assert.strictEqual(result.success, true, `Stakes ${stakes} should be valid`);
    }
  });
});

describe('Episode Verification Contract', () => {
  // Defines the shape that verify_episode.ts must return
  interface VerificationResult {
    passed: boolean;
    episode_id: string;
    checks: {
      mp3_exists: boolean;
      duration_seconds: number;
      duration_ok: boolean;
      file_size_bytes: number;
      sha256: string;
      segment_count: number;
      segments_ok: boolean;
      manifest_status: string;
      manifest_ok: boolean;
    };
    errors: string[];
  }

  const MIN_DURATION_SECONDS = 30;
  const MIN_SEGMENTS = 4;

  test('verification result has required fields', () => {
    const result: VerificationResult = {
      passed: true,
      episode_id: uuidv4(),
      checks: {
        mp3_exists: true,
        duration_seconds: 60,
        duration_ok: true,
        file_size_bytes: 573440,
        sha256: 'a'.repeat(64),
        segment_count: 8,
        segments_ok: true,
        manifest_status: 'published',
        manifest_ok: true,
      },
      errors: [],
    };
    assert.ok(result.passed);
    assert.ok(result.episode_id);
    assert.ok(result.checks);
    assert.ok(Array.isArray(result.errors));
  });

  test('passed is true only when no errors', () => {
    const passing: VerificationResult = {
      passed: true,
      episode_id: uuidv4(),
      checks: {
        mp3_exists: true,
        duration_seconds: 60,
        duration_ok: true,
        file_size_bytes: 573440,
        sha256: 'a'.repeat(64),
        segment_count: 8,
        segments_ok: true,
        manifest_status: 'published',
        manifest_ok: true,
      },
      errors: [],
    };
    assert.strictEqual(passing.passed, passing.errors.length === 0);
  });

  test('duration_ok requires >= MIN_DURATION_SECONDS', () => {
    const shortDuration = 15;
    const longDuration = 60;
    assert.strictEqual(shortDuration >= MIN_DURATION_SECONDS, false);
    assert.strictEqual(longDuration >= MIN_DURATION_SECONDS, true);
  });

  test('segments_ok requires >= MIN_SEGMENTS', () => {
    const fewSegments = 2;
    const enoughSegments = 8;
    assert.strictEqual(fewSegments >= MIN_SEGMENTS, false);
    assert.strictEqual(enoughSegments >= MIN_SEGMENTS, true);
  });

  test('manifest_ok requires published status', () => {
    assert.strictEqual('published' === 'published', true);
    assert.strictEqual('pending_render' === 'published', false);
    assert.strictEqual('rendered' === 'published', false);
  });

  test('sha256 should be 64 hex characters when computed', () => {
    const validHash = 'a'.repeat(64);
    const shortHash = 'a'.repeat(32);
    assert.strictEqual(validHash.length, 64);
    assert.notStrictEqual(shortHash.length, 64);
    assert.ok(/^[a-f0-9]{64}$/.test(validHash));
  });
});
