#!/usr/bin/env tsx
/**
 * Episode Verification Script
 *
 * Validates that an episode was produced correctly:
 * - MP3 file exists
 * - Duration >= 30 seconds
 * - File size > 0
 * - SHA256 computable
 * - N segments rendered (narrator + agent)
 * - Manifest exists with 'published' status
 *
 * Usage: pnpm exec tsx scripts/audio/verify_episode.ts [episode_id]
 *    OR: make verify-episode0
 *
 * Exit codes:
 *   0 = all checks passed
 *   1 = verification failed
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const MIN_DURATION_SECONDS = 30;
const MIN_SEGMENTS = 4;

interface EpisodeManifest {
  episode_id: string;
  title: string;
  segments: Array<{ segment_id: string; kind: string }>;
  status: string;
}

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
      created: JSON.parse(fs.readFileSync(d.manifest, 'utf-8')).created_at || '1970-01-01',
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
    return 0;
  }
}

function verifyEpisode(episodeId: string): VerificationResult {
  const errors: string[] = [];
  const episodeDir = path.join(DATA_DIR, 'episodes', episodeId);
  const mp3Path = path.join(episodeDir, 'episode.mp3');
  const manifestPath = path.join(episodeDir, 'manifest.json');

  // Check MP3 exists
  const mp3Exists = fs.existsSync(mp3Path);
  if (!mp3Exists) {
    errors.push(`MP3 file not found: ${mp3Path}`);
  }

  // Check manifest exists
  let manifest: EpisodeManifest | null = null;
  let manifestStatus = 'not_found';
  let segmentCount = 0;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      manifestStatus = manifest?.status || 'unknown';
      segmentCount = manifest?.segments?.length || 0;
    } catch {
      errors.push(`Failed to parse manifest: ${manifestPath}`);
    }
  } else {
    errors.push(`Manifest not found: ${manifestPath}`);
  }

  // Check duration
  let durationSeconds = 0;
  if (mp3Exists) {
    durationSeconds = getAudioDuration(mp3Path);
    if (durationSeconds < MIN_DURATION_SECONDS) {
      errors.push(`Duration too short: ${durationSeconds}s (min: ${MIN_DURATION_SECONDS}s)`);
    }
  }

  // Check file size
  let fileSizeBytes = 0;
  if (mp3Exists) {
    fileSizeBytes = fs.statSync(mp3Path).size;
    if (fileSizeBytes === 0) {
      errors.push('MP3 file is empty');
    }
  }

  // Check SHA256
  let sha256 = '';
  if (mp3Exists && fileSizeBytes > 0) {
    const fileBuffer = fs.readFileSync(mp3Path);
    sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  }

  // Check segments
  if (segmentCount < MIN_SEGMENTS) {
    errors.push(`Not enough segments: ${segmentCount} (min: ${MIN_SEGMENTS})`);
  }

  // Check manifest status
  const manifestOk = manifestStatus === 'published';
  if (!manifestOk) {
    errors.push(`Manifest status not 'published': ${manifestStatus}`);
  }

  return {
    passed: errors.length === 0,
    episode_id: episodeId,
    checks: {
      mp3_exists: mp3Exists,
      duration_seconds: Math.round(durationSeconds),
      duration_ok: durationSeconds >= MIN_DURATION_SECONDS,
      file_size_bytes: fileSizeBytes,
      sha256,
      segment_count: segmentCount,
      segments_ok: segmentCount >= MIN_SEGMENTS,
      manifest_status: manifestStatus,
      manifest_ok: manifestOk,
    },
    errors,
  };
}

function printResult(result: VerificationResult): void {
  console.log('='.repeat(60));
  console.log('EPISODE VERIFICATION REPORT');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Episode ID:       ${result.episode_id}`);
  console.log(`MP3 Exists:       ${result.checks.mp3_exists ? 'YES' : 'NO'}`);
  console.log(`Duration:         ${result.checks.duration_seconds}s ${result.checks.duration_ok ? '' : '(FAIL)'}`);
  console.log(`File Size:        ${result.checks.file_size_bytes} bytes (${Math.round(result.checks.file_size_bytes / 1024)} KB)`);
  console.log(`SHA256:           ${result.checks.sha256 || 'N/A'}`);
  console.log(`Segments:         ${result.checks.segment_count} ${result.checks.segments_ok ? '' : '(FAIL)'}`);
  console.log(`Manifest Status:  ${result.checks.manifest_status} ${result.checks.manifest_ok ? '' : '(FAIL)'}`);
  console.log('');

  if (result.errors.length > 0) {
    console.log('ERRORS:');
    result.errors.forEach(e => console.log(`  - ${e}`));
    console.log('');
  }

  console.log('='.repeat(60));
  console.log(result.passed ? 'VERIFICATION PASSED' : 'VERIFICATION FAILED');
  console.log('='.repeat(60));
}

async function main(): Promise<void> {
  let episodeId = process.argv[2];

  if (!episodeId) {
    episodeId = findLatestEpisode() || '';
    if (!episodeId) {
      console.error('ERROR: No episodes found. Run `make episode0` first.');
      process.exit(1);
    }
    console.log(`Using latest episode: ${episodeId}`);
    console.log('');
  }

  const result = verifyEpisode(episodeId);
  printResult(result);

  // Output JSON for programmatic use
  if (process.env.JSON_OUTPUT === '1') {
    console.log('\nJSON:');
    console.log(JSON.stringify(result, null, 2));
  }

  process.exit(result.passed ? 0 : 1);
}

main();
