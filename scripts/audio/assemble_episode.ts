#!/usr/bin/env tsx
/**
 * Episode Assembler - Stitches audio segments into a single MP3
 *
 * Usage: pnpm exec tsx scripts/audio/assemble_episode.ts [episode_id]
 *    OR: make assemble-episode0
 *
 * Prerequisites:
 * - ffmpeg installed (brew install ffmpeg)
 * - Episode segments rendered (make render-episode0)
 *
 * This script:
 * 1. Reads episode manifest
 * 2. Orders segments according to manifest
 * 3. Concatenates WAV files using ffmpeg
 * 4. Converts to MP3
 * 5. Emits episode.published.v1 event
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import {
  buildEvent,
  publishEvent,
  AUDIO_TOPIC,
  EPISODE_PUBLISHED_EVENT_TYPE,
  EpisodePublishedPayload,
} from '@platform/events';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000003';

// ============================================================================
// Types
// ============================================================================

interface EpisodeSegment {
  segment_id: string;
  kind: 'narrator' | 'agent';
  text: string;
}

interface EpisodeManifest {
  episode_id: string;
  title: string;
  segments: EpisodeSegment[];
  status: string;
}

// ============================================================================
// Helpers
// ============================================================================

function checkFfmpeg(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

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

function getAudioDuration(filePath: string): number {
  try {
    const output = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return parseFloat(output.trim()) || 0;
  } catch {
    // Fallback: estimate from file size
    const stats = fs.statSync(filePath);
    return Math.max(1, Math.round(stats.size / 44100));
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(50));
  console.log('OX AUDIO - EPISODE ASSEMBLER');
  console.log('='.repeat(50));
  console.log('');

  // Check ffmpeg
  console.log('[1/5] Checking ffmpeg...');
  if (!checkFfmpeg()) {
    console.error('ERROR: ffmpeg not found. Install with: brew install ffmpeg');
    process.exit(1);
  }
  console.log('  ffmpeg is available');

  // Get episode ID
  let episodeId = process.argv[2];
  if (!episodeId) {
    episodeId = findLatestEpisode() || '';
    if (!episodeId) {
      console.error('ERROR: No episodes found. Run `make gen-episode0` first.');
      process.exit(1);
    }
    console.log(`  Using latest episode: ${episodeId}`);
  }

  // Load manifest
  console.log('[2/5] Loading manifest...');
  const episodeDir = path.join(DATA_DIR, 'episodes', episodeId);
  const manifestPath = path.join(episodeDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error(`ERROR: Manifest not found at ${manifestPath}`);
    process.exit(1);
  }

  const manifest: EpisodeManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  console.log(`  Episode: ${manifest.title}`);
  console.log(`  Segments: ${manifest.segments.length}`);

  // Check all segments are rendered
  console.log('[3/5] Verifying segments...');
  const segmentFiles: string[] = [];
  let missingSegments = false;

  for (const seg of manifest.segments) {
    const wavPath = path.join(episodeDir, `${seg.segment_id}.wav`);
    if (!fs.existsSync(wavPath)) {
      console.error(`  MISSING: ${seg.segment_id}.wav`);
      missingSegments = true;
    } else {
      segmentFiles.push(wavPath);
      console.log(`  OK: ${seg.segment_id}.wav`);
    }
  }

  if (missingSegments) {
    console.error('\nERROR: Some segments not rendered. Run `make render-episode0` first.');
    process.exit(1);
  }

  // Create ffmpeg concat file
  console.log('[4/5] Assembling audio...');
  const concatFilePath = path.join(episodeDir, 'concat.txt');
  const concatContent = segmentFiles.map(f => `file '${f}'`).join('\n');
  fs.writeFileSync(concatFilePath, concatContent);

  // Concatenate to WAV first
  const combinedWavPath = path.join(episodeDir, 'episode_combined.wav');
  const outputMp3Path = path.join(episodeDir, 'episode.mp3');

  try {
    // Concatenate all WAV files
    console.log('  Concatenating WAV files...');
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatFilePath}" -c copy "${combinedWavPath}"`,
      { stdio: 'pipe' }
    );

    // Convert to MP3
    console.log('  Converting to MP3...');
    execSync(
      `ffmpeg -y -i "${combinedWavPath}" -codec:a libmp3lame -qscale:a 2 "${outputMp3Path}"`,
      { stdio: 'pipe' }
    );

    // Clean up intermediate files
    fs.unlinkSync(concatFilePath);
    fs.unlinkSync(combinedWavPath);

  } catch (err) {
    console.error('ERROR: ffmpeg failed:', err);
    process.exit(1);
  }

  // Calculate final metadata
  console.log('[5/5] Finalizing...');
  const mp3Buffer = fs.readFileSync(outputMp3Path);
  const sha256 = crypto.createHash('sha256').update(mp3Buffer).digest('hex');
  const durationSeconds = getAudioDuration(outputMp3Path);
  const fileSizeKB = Math.round(mp3Buffer.length / 1024);

  // Update manifest
  manifest.status = 'published';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Emit published event
  try {
    const payload: EpisodePublishedPayload = {
      episode_id: episodeId,
      ts: new Date().toISOString(),
      audio_uri: outputMp3Path,
      sha256,
      duration_seconds: durationSeconds,
    };
    const evt = buildEvent(EPISODE_PUBLISHED_EVENT_TYPE, payload, { actorId: SYSTEM_ACTOR_ID });
    await publishEvent(AUDIO_TOPIC, evt);
    console.log('  Event emitted: episode.published.v1');
  } catch {
    console.log('  Event emission skipped (Kafka not available)');
  }

  console.log('');
  console.log('='.repeat(50));
  console.log('EPISODE ASSEMBLED');
  console.log('='.repeat(50));
  console.log(`Episode ID: ${episodeId}`);
  console.log(`Title: ${manifest.title}`);
  console.log(`Duration: ${Math.round(durationSeconds)}s (~${Math.ceil(durationSeconds / 60)} min)`);
  console.log(`File size: ${fileSizeKB} KB`);
  console.log(`SHA256: ${sha256.slice(0, 32)}...`);
  console.log(`Output: ${outputMp3Path}`);
  console.log('');
  console.log('Play with: open ' + outputMp3Path);
  console.log('       OR: afplay ' + outputMp3Path);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
