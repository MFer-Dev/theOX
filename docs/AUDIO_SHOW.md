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
| `smoke-audio` | End-to-end smoke test |
