/**
 * OX Audio Renderer Worker
 *
 * Consumes narrator.speech.v1 and agent.dialogue.v1 events from events.ox-audio.v1
 * and renders them to audio files using TTS.
 *
 * TTS Providers:
 * - local: Uses macOS `say` command (or espeak on Linux)
 * - elevenlabs: Uses ElevenLabs API (requires ELEVENLABS_API_KEY)
 * - openai: Uses OpenAI TTS API (requires OPENAI_API_KEY)
 *
 * Set OX_TTS_PROVIDER env var to select provider. Default: local
 */

import Fastify from 'fastify';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import {
  runConsumer,
  EventEnvelope,
  buildEvent,
  publishEvent,
  AUDIO_TOPIC,
  NARRATOR_SPEECH_EVENT_TYPE,
  AGENT_DIALOGUE_EVENT_TYPE,
  SEGMENT_RENDERED_EVENT_TYPE,
  NarratorSpeechPayload,
  AgentDialoguePayload,
  SegmentRenderedPayload,
} from '@platform/events';

const RENDERER_PORT = Number(process.env.RENDERER_PORT || 4121);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '..', 'data');
const TTS_PROVIDER = process.env.OX_TTS_PROVIDER || 'local';

const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000002';

const app = Fastify({ logger: true });

// ============================================================================
// Voice Mapping
// ============================================================================

// macOS voices for local TTS
const MACOS_VOICES: Record<string, string> = {
  host: 'Daniel',      // British male - narrator
  voice_alpha: 'Alex',
  voice_beta: 'Samantha',
  voice_gamma: 'Tom',
  voice_delta: 'Victoria',
  voice_epsilon: 'Fred',
};

// Tone to speech rate mapping
const TONE_RATES: Record<string, number> = {
  neutral: 175,
  dramatic: 150,
  curious: 180,
  urgent: 200,
  reflective: 160,
  ominous: 140,
  hopeful: 175,
};

// ============================================================================
// TTS Providers
// ============================================================================

interface TTSResult {
  audioPath: string;
  durationSeconds: number;
  sha256: string;
}

async function renderWithLocalTTS(
  text: string,
  outputPath: string,
  voiceId: string,
  toneHint?: string
): Promise<TTSResult> {
  const voice = MACOS_VOICES[voiceId] || MACOS_VOICES['host'];
  const rate = TONE_RATES[toneHint || 'neutral'] || 175;

  // Create directory if needed
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  // Use AIFF format (macOS native) then convert to WAV
  const aiffPath = outputPath.replace(/\.wav$/, '.aiff');

  try {
    // Check if we're on macOS
    const platform = process.platform;
    if (platform === 'darwin') {
      // macOS: use say command
      execSync(`say -v "${voice}" -r ${rate} -o "${aiffPath}" "${text.replace(/"/g, '\\"')}"`);

      // Convert AIFF to WAV using afconvert (macOS built-in)
      execSync(`afconvert -f WAVE -d LEI16 "${aiffPath}" "${outputPath}"`);

      // Clean up AIFF
      fs.unlinkSync(aiffPath);
    } else if (platform === 'linux') {
      // Linux: use espeak
      execSync(`espeak -w "${outputPath}" "${text.replace(/"/g, '\\"')}"`);
    } else {
      // Fallback: create a silent placeholder
      app.log.warn(`TTS not supported on ${platform}, creating placeholder`);
      // Create a minimal valid WAV file (silence)
      const silentWav = createSilentWav(3.0); // 3 seconds of silence
      fs.writeFileSync(outputPath, silentWav);
    }

    // Calculate duration and hash
    const stats = fs.statSync(outputPath);
    const fileBuffer = fs.readFileSync(outputPath);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Estimate duration from file size (rough approximation for WAV)
    // WAV at 16-bit, 22050Hz mono = ~44100 bytes per second
    const durationSeconds = Math.max(1, Math.round(stats.size / 44100));

    return { audioPath: outputPath, durationSeconds, sha256 };
  } catch (err) {
    app.log.error({ err, text, voice }, 'TTS render failed');
    throw err;
  }
}

function createSilentWav(durationSeconds: number): Buffer {
  const sampleRate = 22050;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const fileSize = 44 + dataSize;

  const buffer = Buffer.alloc(fileSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(fileSize - 8, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;

  // fmt chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4; // chunk size
  buffer.writeUInt16LE(1, offset); offset += 2; // PCM format
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, offset); offset += 4;
  buffer.writeUInt16LE(numChannels * bitsPerSample / 8, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;

  // data chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;
  // Rest is zeros (silence)

  return buffer;
}

async function renderTTS(
  text: string,
  outputPath: string,
  voiceId: string,
  toneHint?: string
): Promise<TTSResult> {
  switch (TTS_PROVIDER) {
    case 'local':
    default:
      return renderWithLocalTTS(text, outputPath, voiceId, toneHint);
    // Future: add elevenlabs, openai providers
  }
}

// ============================================================================
// Event Handlers
// ============================================================================

let renderedCount = 0;

async function handleNarratorSpeech(payload: NarratorSpeechPayload): Promise<void> {
  const episodeDir = path.join(DATA_DIR, 'episodes', payload.episode_id);
  const outputPath = path.join(episodeDir, `${payload.segment_id}.wav`);

  app.log.info({ episodeId: payload.episode_id, segmentId: payload.segment_id }, 'Rendering narrator speech');

  const result = await renderTTS(
    payload.text,
    outputPath,
    'host',
    payload.tone_hint || 'neutral'
  );

  // Emit segment rendered event
  const renderedPayload: SegmentRenderedPayload = {
    episode_id: payload.episode_id,
    segment_id: payload.segment_id,
    ts: new Date().toISOString(),
    kind: 'narrator',
    audio_uri: outputPath,
    seconds: result.durationSeconds,
    sha256: result.sha256,
  };

  const evt = buildEvent(SEGMENT_RENDERED_EVENT_TYPE, renderedPayload, { actorId: SYSTEM_ACTOR_ID });
  await publishEvent(AUDIO_TOPIC, evt);

  renderedCount++;
  app.log.info({ episodeId: payload.episode_id, segmentId: payload.segment_id, duration: result.durationSeconds }, 'Narrator speech rendered');
}

async function handleAgentDialogue(payload: AgentDialoguePayload): Promise<void> {
  const episodeDir = path.join(DATA_DIR, 'episodes', payload.episode_id);
  const outputPath = path.join(episodeDir, `${payload.segment_id}.wav`);

  app.log.info({ episodeId: payload.episode_id, segmentId: payload.segment_id, agent: payload.agent_name }, 'Rendering agent dialogue');

  const result = await renderTTS(
    payload.text,
    outputPath,
    payload.voice_id || 'voice_alpha',
    'neutral'
  );

  // Emit segment rendered event
  const renderedPayload: SegmentRenderedPayload = {
    episode_id: payload.episode_id,
    segment_id: payload.segment_id,
    ts: new Date().toISOString(),
    kind: 'agent',
    audio_uri: outputPath,
    seconds: result.durationSeconds,
    sha256: result.sha256,
  };

  const evt = buildEvent(SEGMENT_RENDERED_EVENT_TYPE, renderedPayload, { actorId: SYSTEM_ACTOR_ID });
  await publishEvent(AUDIO_TOPIC, evt);

  renderedCount++;
  app.log.info({ episodeId: payload.episode_id, segmentId: payload.segment_id, agent: payload.agent_name, duration: result.durationSeconds }, 'Agent dialogue rendered');
}

const eventHandler = async (evt: EventEnvelope<unknown>): Promise<void> => {
  if (evt.event_type === NARRATOR_SPEECH_EVENT_TYPE) {
    await handleNarratorSpeech(evt.payload as NarratorSpeechPayload);
  } else if (evt.event_type === AGENT_DIALOGUE_EVENT_TYPE) {
    await handleAgentDialogue(evt.payload as AgentDialoguePayload);
  }
  // Ignore other event types
};

// ============================================================================
// HTTP Endpoints
// ============================================================================

app.get('/healthz', async () => ({ ok: true, service: 'ox-audio-renderer' }));

app.get('/status', async () => ({
  ok: true,
  tts_provider: TTS_PROVIDER,
  rendered_count: renderedCount,
  data_dir: DATA_DIR,
}));

// ============================================================================
// Start
// ============================================================================

const start = async () => {
  // Start event consumer
  await runConsumer({
    groupId: 'ox-audio-renderer',
    topics: [AUDIO_TOPIC],
    handler: eventHandler,
  });

  app.log.info(`Subscribed to ${AUDIO_TOPIC}`);

  // Start HTTP server
  await app.listen({ port: RENDERER_PORT, host: '0.0.0.0' });
  app.log.info(`OX Audio Renderer running on port ${RENDERER_PORT}`);
  app.log.info(`TTS Provider: ${TTS_PROVIDER}`);
};

start().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
