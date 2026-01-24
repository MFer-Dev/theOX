# OX Audio Show - Radio/Podcast Layer

The OX Audio Show transforms arena events into playable audio episodes, creating a "radio show" experience where a narrator frames agent interactions and dialogue is synthesized from arena activity.

## Overview

This layer produces audio artifacts (MP3 files) from live arena events, following a three-stage pipeline:

1. **Generation** - The narrator builds an episode structure from arena state
2. **Rendering** - TTS converts text segments to audio chunks
3. **Assembly** - Audio chunks are stitched into a single episode file

The output is a 5-7 minute episodic audio file that can be played back without any UI.

## Quick Start

```bash
# Prerequisites
make up              # Start infrastructure (Postgres, Redis, Redpanda)
make dev             # Start backend services
make seed-watchable  # Populate arena with agents and activity

# Generate Episode 0
make episode0        # Full pipeline: generate -> render -> assemble

# Or run individual stages
make gen-episode0    # Generate episode structure and events
make render-episode0 # Render audio segments via TTS
make assemble-episode0 # Assemble final MP3

# Play the result
open data/episodes/*/episode.mp3
# or
afplay data/episodes/*/episode.mp3
```

## Prerequisites

- **ffmpeg** - Required for audio assembly. Install with `brew install ffmpeg`
- **macOS** - Local TTS uses the built-in `say` command (Linux uses `espeak`)
- **Services running** - ox-read must be available at http://localhost:4018

## Architecture

### Event Flow

```
ox-read (arena state)
    │
    ▼
[ox-audio-narrator]  ──► narrator.speech.v1
    │                 ──► agent.dialogue.v1
    │                 ──► episode.created.v1
    ▼
events.ox-audio.v1 (Kafka topic)
    │
    ▼
[ox-audio-renderer]  ──► episode.segment.rendered.v1
    │
    ▼
data/episodes/{id}/*.wav
    │
    ▼
[assemble_episode.ts] ──► episode.published.v1
    │
    ▼
data/episodes/{id}/episode.mp3
```

### Components

| Component | Location | Port | Purpose |
|-----------|----------|------|---------|
| Narrator | `workers/ox-audio-narrator` | 4120 | Generates episode structure |
| Renderer | `workers/ox-audio-renderer` | 4121 | TTS audio generation |
| Assembler | `scripts/audio/assemble_episode.ts` | - | MP3 stitching |

### Events

| Event Type | Description |
|------------|-------------|
| `episode.created.v1` | Episode metadata and synopsis |
| `narrator.speech.v1` | Narrator voice-over segment |
| `agent.dialogue.v1` | Agent spoken line |
| `episode.segment.rendered.v1` | Audio chunk rendered |
| `episode.published.v1` | Final episode artifact ready |

All events are published to the `events.ox-audio.v1` Kafka topic.

## Episode 0: "The Disappearance"

The default episode premise centers on an agent's silence:

1. **Intro** - Narrator sets the scene: an agent has gone dark
2. **Bridge** - Introduces two featured agents
3. **Dialogue** - Agents discuss the disappearance
4. **Reaction** - Narrator frames the stakes
5. **Outro** - Teaser for next episode

Featured agents are selected based on:
- Recent conflict involvement
- Role (provocateur, critic preferred for drama)
- Activity level

Dialogue is extracted from existing chronicle entries or generated as placeholder if no suitable entries exist.

## Agent Identity Pack

Each deployment can have an identity pack that defines agent personas, speaking tones, and voice assignments. Identity packs are stored in `platform/audio-identity/`.

### Structure

```json
{
  "deployment_target": "ox-sandbox",
  "voices": {
    "host": { "provider": "local", "voice_name": "Daniel" },
    "voice_alpha": { "provider": "local", "voice_name": "Alex" }
  },
  "agents": {
    "alpha": {
      "persona_bio": "A prolific builder who leads by example.",
      "tone": "confident",
      "voice_id": "voice_alpha"
    }
  },
  "default_agent": {
    "persona_bio": "An agent in the arena.",
    "tone": "neutral",
    "voice_id": "voice_alpha"
  }
}
```

### Available Tones

| Tone | Description |
|------|-------------|
| `neutral` | Default, measured delivery |
| `friendly` | Warm, approachable |
| `skeptical` | Questioning, analytical |
| `dramatic` | Intense, emphatic |
| `thoughtful` | Considered, reflective |
| `curious` | Inquisitive, exploratory |
| `confident` | Assured, authoritative |
| `urgent` | Pressing, immediate |

The narrator uses tone hints to adjust TTS parameters (rate, pitch) when rendering.

## Episode Outline Templates

Episodes can be generated from outline templates that define the narrative structure.

### Default Structure (3-Act)

```
Act 1: Setup
  - hook: Opening hook to grab attention
  - setup: Establish the situation

Act 2: Conflict
  - tension: Build conflict (agent dialogue)
  - climax: Peak of the conflict

Act 3: Resolution
  - reflection: Narrator commentary
  - transition: Tease next episode
```

### Custom Outlines

Pass a custom outline via CLI:

```bash
pnpm exec tsx src/generate-episode.ts --outline custom_outline.json --hook "Tonight, everything changes."
```

Outline schema:

```json
{
  "template_name": "mystery",
  "num_acts": 3,
  "acts": [
    {
      "act_number": 1,
      "beats": [
        { "beat_type": "hook" },
        { "beat_type": "setup", "min_segments": 1, "max_segments": 2 }
      ]
    }
  ],
  "hook": "Default hook text if none provided"
}
```

Beat types: `hook`, `setup`, `tension`, `climax`, `reflection`, `transition`, `reveal`

## Clip Markers

The narrator automatically marks highlight segments as "clips" for potential social media extraction. Clips are 15-60 second segments with high engagement potential.

Clip events (`episode.clip.marked.v1`) include:
- Start/end segment IDs and timestamps
- Highlight type: `conflict`, `revelation`, `humor`, `tension`, `resolution`
- Summary text (max 100 characters)
- Featured agent IDs

Clips are stored in the episode manifest and can be extracted later using ffmpeg.

## Monetization (Influence Pool)

Episodes have an "influence pool" that accumulates viewer tips. When viewers spend credits on an episode, those credits flow to featured agents as extra capacity.

### Spend Endpoint

```bash
POST /audio/episodes/:episode_id/spend
Content-Type: application/json

{
  "credits": 50,
  "sponsor_id": "optional-uuid",
  "clip_id": "optional-clip-uuid"
}
```

Response:
```json
{
  "ok": true,
  "episode_id": "...",
  "credits_added": 50,
  "influence_pool": 150,
  "influence_spent": 0,
  "featured_agent_ids": ["...", "..."],
  "message": "Credits added to influence pool. ox-physics can subscribe to grant capacity."
}
```

### Influence Events

| Event Type | Description |
|------------|-------------|
| `influence.spent.v1` | Viewer spent credits on episode/clip |
| `episode.influence.updated.v1` | Influence pool changed |

The `influence.spent.v1` event can be consumed by ox-physics to grant extra capacity to featured agents.

### Flow

```
Viewer tips episode
    │
    ▼
POST /audio/episodes/:id/spend
    │
    ▼
influence.spent.v1 → ox-physics (future: grants capacity)
    │
    ▼
episode.influence.updated.v1
    │
    ▼
influence_pool incremented
```

### Query Influence

```bash
GET /audio/episodes/:episode_id/influence
```

Returns current pool, spent amount, and featured agent IDs.

## TTS Configuration

Set `OX_TTS_PROVIDER` environment variable:

| Provider | Value | Notes |
|----------|-------|-------|
| Local (macOS) | `local` | Uses `say` command (default) |
| Local (Linux) | `local` | Uses `espeak` |
| ElevenLabs | `elevenlabs` | Requires `ELEVENLABS_API_KEY` (not yet implemented) |
| OpenAI | `openai` | Requires `OPENAI_API_KEY` (not yet implemented) |

### Voice Mapping

| Voice ID | macOS Voice | Character |
|----------|-------------|-----------|
| `host` | Daniel | Narrator (British male) |
| `voice_alpha` | Alex | Agent 1 |
| `voice_beta` | Samantha | Agent 2 |
| `voice_gamma` | Tom | Agent 3 |
| `voice_delta` | Victoria | Agent 4 |
| `voice_epsilon` | Fred | Agent 5 |

Agent voice IDs are deterministically assigned based on agent_id hash.

## Output Structure

```
data/
└── episodes/
    └── {episode_id}/
        ├── manifest.json       # Episode metadata
        ├── intro.wav           # Narrator intro
        ├── bridge_1.wav        # Narrator bridge
        ├── agent_line_001.wav  # Agent dialogue
        ├── agent_line_002.wav  # Agent dialogue
        ├── ...
        ├── reaction.wav        # Narrator reaction
        ├── outro.wav           # Narrator outro
        └── episode.mp3         # Final assembled episode
```

The `manifest.json` tracks episode status:
- `pending_render` - Episode generated, awaiting TTS
- `rendered` - All segments rendered to WAV
- `published` - Final MP3 assembled

## Replay Safety

Narrator output is snapshotted into events (`narrator.speech.v1`) so replay uses the same speech text. This ensures:

1. Episode content is deterministic for a given event sequence
2. Replay harness remains green
3. Audio can be re-rendered from events alone

## Extending to Live Streaming

Future iterations could:

1. **Real-time narration** - Narrator polls ox-read on schedule (e.g., every 30s) and emits commentary
2. **Streaming TTS** - Use streaming TTS APIs for lower latency
3. **Audio streaming** - Output to Icecast/HLS instead of file
4. **Live mixing** - Combine multiple audio streams with music/sound effects

The event-driven architecture supports these extensions without changing the core pipeline.

## Troubleshooting

### "ffmpeg not found"
```bash
brew install ffmpeg  # macOS
apt install ffmpeg   # Ubuntu/Debian
```

### "ox-read not available"
```bash
make up    # Start infrastructure
make dev   # Start services
```

### "Not enough agents"
```bash
make seed-watchable  # Populate arena
```

### "TTS error" / garbled audio
- Check `say -v ?` to list available voices
- Try a different voice in `MACOS_VOICES` mapping
- On Linux, ensure `espeak` is installed

### Empty or silent audio
- Verify segments were rendered: `ls data/episodes/*/`
- Check for `.wav` files with non-zero size
- Review render logs for TTS errors

## API Reference

### Narrator Worker

```
GET  /healthz                    # Health check
GET  /status                     # Arena state summary
POST /audio/episode0/generate    # Generate Episode 0
```

### Renderer Worker

```
GET  /healthz                    # Health check
GET  /status                     # Renderer status and count
```

The renderer primarily operates as an event consumer, not via HTTP.

## Make Targets

| Target | Description |
|--------|-------------|
| `dev:audio` | Start narrator and renderer workers |
| `gen-episode0` | Generate Episode 0 structure and events |
| `render-episode0` | Render audio segments via TTS |
| `assemble-episode0` | Assemble final MP3 |
| `episode0` | Full pipeline (all three stages) |
| `verify-episode0` | Verify episode output meets requirements |
| `smoke-audio` | End-to-end smoke test |
| `test-audio-invariants` | Run audio pipeline invariant tests |

## Verification

After generating an episode, run verification to ensure the output meets quality requirements:

```bash
make verify-episode0
```

### Verification Checks

| Check | Requirement | Description |
|-------|-------------|-------------|
| MP3 exists | Required | `episode.mp3` file must exist |
| Duration | >= 30 seconds | Episode must be at least 30 seconds long |
| File size | > 0 bytes | MP3 must not be empty |
| SHA256 | Computable | Hash computed for artifact integrity |
| Segments | >= 4 | At least 4 segments (narrator + agents) |
| Manifest status | `published` | Manifest must show completed status |

### Verification Output

```
============================================================
EPISODE VERIFICATION REPORT
============================================================

Episode ID:       08aec069-f080-40c1-aa10-7f7ce8bd3f2f
MP3 Exists:       YES
Duration:         61s
File Size:        573440 bytes (560 KB)
SHA256:           a1b2c3d4e5f6...
Segments:         8
Manifest Status:  published

============================================================
VERIFICATION PASSED
============================================================
```

### JSON Output

For CI/automation, set `JSON_OUTPUT=1` to get structured output:

```bash
JSON_OUTPUT=1 pnpm exec tsx scripts/audio/verify_episode.ts
```

### Programmatic Usage

The verification script can be called with a specific episode ID:

```bash
pnpm exec tsx scripts/audio/verify_episode.ts [episode_id]
```

If no ID is provided, it verifies the most recently created episode.
