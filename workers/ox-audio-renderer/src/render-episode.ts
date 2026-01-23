#!/usr/bin/env tsx
/**
 * CLI script to render an episode from its manifest
 *
 * Usage: pnpm exec tsx src/render-episode.ts [episode_id]
 *    OR: make render-episode0
 *
 * This script:
 * 1. Reads the episode manifest from data/episodes/{episode_id}/manifest.json
 * 2. Renders each segment to a WAV file using TTS
 * 3. Emits episode.segment.rendered.v1 events
 * 4. Updates manifest status to 'rendered'
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import {
  buildEvent,
  publishEvent,
  AUDIO_TOPIC,
  SEGMENT_RENDERED_EVENT_TYPE,
  SegmentRenderedPayload,
} from '@platform/events';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '..', '..', 'data');
const TTS_PROVIDER = process.env.OX_TTS_PROVIDER || 'local';
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000002';

// ============================================================================
// Types
// ============================================================================

interface EpisodeSegment {
  segment_id: string;
  kind: 'narrator' | 'agent';
  text: string;
  agent_id?: string;
  agent_name?: string;
  voice_id?: string;
  tone_hint?: string;
}

interface EpisodeManifest {
  episode_id: string;
  title: string;
  deployment_target: string;
  created_at: string;
  segments: EpisodeSegment[];
  synopsis: unknown;
  status: string;
}

interface TTSResult {
  audioPath: string;
  durationSeconds: number;
  sha256: string;
}

// ============================================================================
// Voice Mapping
// ============================================================================

const MACOS_VOICES: Record<string, string> = {
  host: 'Daniel',
  voice_alpha: 'Alex',
  voice_beta: 'Samantha',
  voice_gamma: 'Tom',
  voice_delta: 'Victoria',
  voice_epsilon: 'Fred',
};

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
// TTS
// ============================================================================

function createSilentWav(durationSeconds: number): Buffer {
  const sampleRate = 22050;
  const numChannels = 1;
  const bitsPerSample = 16;
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const fileSize = 44 + dataSize;

  const buffer = Buffer.alloc(fileSize);
  let offset = 0;

  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(fileSize - 8, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4;
  buffer.writeUInt16LE(1, offset); offset += 2;
  buffer.writeUInt16LE(numChannels, offset); offset += 2;
  buffer.writeUInt32LE(sampleRate, offset); offset += 4;
  buffer.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, offset); offset += 4;
  buffer.writeUInt16LE(numChannels * bitsPerSample / 8, offset); offset += 2;
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2;
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset);

  return buffer;
}

function renderLocalTTS(text: string, outputPath: string, voiceId: string, toneHint?: string): TTSResult {
  const voice = MACOS_VOICES[voiceId] || MACOS_VOICES['host'];
  const rate = TONE_RATES[toneHint || 'neutral'] || 175;

  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  const aiffPath = outputPath.replace(/\.wav$/, '.aiff');
  const platform = process.platform;

  // Escape text for shell
  const escapedText = text.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');

  try {
    if (platform === 'darwin') {
      execSync(`say -v "${voice}" -r ${rate} -o "${aiffPath}" "${escapedText}"`, { stdio: 'pipe' });
      execSync(`afconvert -f WAVE -d LEI16 "${aiffPath}" "${outputPath}"`, { stdio: 'pipe' });
      if (fs.existsSync(aiffPath)) fs.unlinkSync(aiffPath);
    } else if (platform === 'linux') {
      execSync(`espeak -w "${outputPath}" "${escapedText}"`, { stdio: 'pipe' });
    } else {
      console.warn(`  TTS not supported on ${platform}, using placeholder`);
      const silentWav = createSilentWav(3.0);
      fs.writeFileSync(outputPath, silentWav);
    }

    const stats = fs.statSync(outputPath);
    const fileBuffer = fs.readFileSync(outputPath);
    const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const durationSeconds = Math.max(1, Math.round(stats.size / 44100));

    return { audioPath: outputPath, durationSeconds, sha256 };
  } catch (err) {
    console.error(`  TTS error for: ${text.slice(0, 50)}...`);
    // Create placeholder on error
    const silentWav = createSilentWav(3.0);
    fs.writeFileSync(outputPath, silentWav);
    const sha256 = crypto.createHash('sha256').update(silentWav).digest('hex');
    return { audioPath: outputPath, durationSeconds: 3, sha256 };
  }
}

// ============================================================================
// Find latest episode
// ============================================================================

function findLatestEpisode(): string | null {
  const episodesDir = path.join(DATA_DIR, 'episodes');
  if (!fs.existsSync(episodesDir)) return null;

  const dirs = fs.readdirSync(episodesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({
      name: d.name,
      manifest: path.join(episodesDir, d.name, 'manifest.json'),
    }))
    .filter(d => fs.existsSync(d.manifest))
    .map(d => ({
      ...d,
      created: JSON.parse(fs.readFileSync(d.manifest, 'utf-8')).created_at,
    }))
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

  return dirs.length > 0 ? dirs[0].name : null;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(50));
  console.log('OX AUDIO - EPISODE RENDERER');
  console.log('='.repeat(50));
  console.log('');

  // Get episode ID from args or find latest
  let episodeId = process.argv[2];
  if (!episodeId) {
    episodeId = findLatestEpisode() || '';
    if (!episodeId) {
      console.error('ERROR: No episodes found. Run `make gen-episode0` first.');
      process.exit(1);
    }
    console.log(`Using latest episode: ${episodeId}`);
  }

  // Load manifest
  const manifestPath = path.join(DATA_DIR, 'episodes', episodeId, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`ERROR: Manifest not found at ${manifestPath}`);
    process.exit(1);
  }

  const manifest: EpisodeManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log(`Episode: ${manifest.title}`);
  console.log(`Segments: ${manifest.segments.length}`);
  console.log(`TTS Provider: ${TTS_PROVIDER}`);
  console.log('');

  // Render each segment
  const results: { segment_id: string; duration: number; path: string }[] = [];
  let totalDuration = 0;

  for (let i = 0; i < manifest.segments.length; i++) {
    const seg = manifest.segments[i];
    const outputPath = path.join(DATA_DIR, 'episodes', episodeId, `${seg.segment_id}.wav`);

    console.log(`[${i + 1}/${manifest.segments.length}] Rendering ${seg.segment_id} (${seg.kind})...`);

    const voiceId = seg.kind === 'narrator' ? 'host' : (seg.voice_id || 'voice_alpha');
    const result = renderLocalTTS(seg.text, outputPath, voiceId, seg.tone_hint);

    console.log(`  Duration: ${result.durationSeconds}s`);
    console.log(`  SHA256: ${result.sha256.slice(0, 16)}...`);

    results.push({ segment_id: seg.segment_id, duration: result.durationSeconds, path: result.audioPath });
    totalDuration += result.durationSeconds;

    // Emit event
    try {
      const payload: SegmentRenderedPayload = {
        episode_id: episodeId,
        segment_id: seg.segment_id,
        ts: new Date().toISOString(),
        kind: seg.kind,
        audio_uri: outputPath,
        seconds: result.durationSeconds,
        sha256: result.sha256,
      };
      const evt = buildEvent(SEGMENT_RENDERED_EVENT_TYPE, payload, { actorId: SYSTEM_ACTOR_ID });
      await publishEvent(AUDIO_TOPIC, evt);
      console.log(`  Event emitted`);
    } catch {
      console.log(`  Event emission skipped (Kafka not available)`);
    }
  }

  // Update manifest status
  manifest.status = 'rendered';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log('');
  console.log('='.repeat(50));
  console.log('RENDERING COMPLETE');
  console.log('='.repeat(50));
  console.log(`Segments rendered: ${results.length}`);
  console.log(`Total duration: ${totalDuration}s (~${Math.ceil(totalDuration / 60)} min)`);
  console.log(`Output directory: ${path.join(DATA_DIR, 'episodes', episodeId)}`);
  console.log('');
  console.log('Next step: make assemble-episode0');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
