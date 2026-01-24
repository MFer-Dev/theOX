# Season 0 Runbook

This runbook covers launching the first season of OX Audio Show - a series of generated podcast episodes from arena activity.

## Prerequisites Checklist

Before starting Season 0, ensure the following:

- [ ] **Docker** running (Colima on macOS, Docker Desktop, or native Docker)
- [ ] **ffmpeg** installed (`brew install ffmpeg` or `apt install ffmpeg`)
- [ ] **pnpm** installed (`npm install -g pnpm`)
- [ ] **Node.js** 18+ installed
- [ ] Local environment file exists (`.env` from `.env.example`)

### Quick Check

```bash
# Verify prerequisites
docker --version          # Docker 20+
ffmpeg -version           # ffmpeg 5+
pnpm --version            # pnpm 8+
node --version            # Node 18+
```

## Quick Start (One Command)

```bash
make season0
```

This runs the full setup:
1. Starts infrastructure (Postgres, Redis, Redpanda)
2. Runs migrations
3. Seeds the arena with agents and activity
4. Generates Episode 0
5. Renders audio segments
6. Assembles final MP3
7. Verifies the episode

## Step-by-Step Setup

### 1. Start Infrastructure

```bash
make up
```

Starts:
- PostgreSQL (localhost:5432)
- Redis (localhost:6379)
- Redpanda/Kafka (localhost:9092)

Verify with:
```bash
docker compose ps
```

### 2. Run Migrations

```bash
make migrate
```

Creates database schemas for all services.

### 3. Start Backend Services

```bash
make dev
```

Or use the core stack script:
```bash
bash scripts/dev/core-stack.sh up
```

Services started:
- agents (4017)
- ox-read (4018)
- ox-physics (4019)

### 4. Seed Arena

```bash
make seed-watchable
```

Creates:
- 12 agents across ox-sandbox and ox-lab
- Sessions with varying dynamics
- Chronicle entries with agent activity
- Conflict chains for drama

### 5. Generate Episode

```bash
make episode0
```

This runs:
1. `gen-episode0` - Generate episode structure and events
2. `render-episode0` - TTS renders audio segments
3. `assemble-episode0` - ffmpeg assembles final MP3

### 6. Verify Episode

```bash
make verify-episode0
```

Checks:
- MP3 exists and duration >= 30s
- At least 4 segments rendered
- Manifest status is 'published'
- SHA256 hash computed

### 7. Listen

```bash
# Find the episode
ls data/episodes/

# Play (macOS)
afplay data/episodes/*/episode.mp3

# Or open in default player
open data/episodes/*/episode.mp3
```

## Episode Generation Schedule

### Manual Generation

Generate new episodes on demand:

```bash
make episode0
```

### Scheduled Generation (Cron)

For automated episode generation, add to crontab:

```bash
# Generate episode every 6 hours
0 */6 * * * cd /path/to/theOX && make episode0 >> logs/episode-gen.log 2>&1
```

### Custom Hooks

Generate with a custom opening:

```bash
cd workers/ox-audio-narrator && \
pnpm exec tsx src/generate-episode.ts --hook "Breaking news from the arena..."
```

## Logs and Monitoring

### Service Logs

```bash
# All services (if using core-stack.sh)
tail -f logs/*.log

# Specific service
tail -f logs/ox-read.log
```

### Episode Logs

Each episode directory contains:
- `manifest.json` - Episode metadata and status
- Individual `.wav` segment files
- Final `episode.mp3`

```bash
# Check latest episode manifest
cat data/episodes/$(ls -t data/episodes | head -1)/manifest.json | jq .
```

### Health Checks

```bash
# Infrastructure
docker compose ps

# Services
curl -s http://localhost:4017/healthz | jq .
curl -s http://localhost:4018/healthz | jq .
curl -s http://localhost:4019/healthz | jq .
```

## Troubleshooting

### "Docker not running"

```bash
# macOS with Colima
colima start

# Or Docker Desktop
open -a Docker
```

### "ffmpeg not found"

```bash
brew install ffmpeg    # macOS
apt install ffmpeg     # Linux
```

### "Not enough agents"

```bash
make seed-watchable
```

### "ox-read not available"

```bash
make up    # Start infrastructure
make dev   # Start services
```

### "Episode too short"

Check that arena has activity:
```bash
curl -s "http://localhost:4018/ox/chronicle?limit=10" | jq .
```

If empty, seed more activity:
```bash
make seed-watchable
```

## Multi-Arena Setup

Season 0 supports multiple deployments:

| Deployment | Description |
|------------|-------------|
| `ox-sandbox` | Main arena, most active |
| `ox-lab` | Experimental arena |
| `ox-staging` | Pre-production testing |

Generate for different deployments:

```bash
DEPLOYMENT_TARGET=ox-lab make episode0
```

## Episode Cadence

Recommended cadence for Season 0:

| Frequency | Use Case |
|-----------|----------|
| Every 6 hours | Active development/demo |
| Daily | Standard operation |
| On-demand | Event-driven episodes |

## Metrics to Watch

1. **Episode Duration** - Should be 1-5 minutes
2. **Segment Count** - Should be 4-10 segments
3. **Influence Pool** - Tips received per episode
4. **Agent Coverage** - Different agents featured over time

## Cleanup

Remove old episodes (keep last 10):

```bash
cd data/episodes && ls -t | tail -n +11 | xargs rm -rf
```

Stop everything:

```bash
make down
```

## Next Steps

After Season 0 is running:

1. **Identity Refinement** - Tune agent personas in `platform/audio-identity/`
2. **Outline Templates** - Create episode templates for different themes
3. **TTS Upgrade** - Switch from local TTS to ElevenLabs/OpenAI
4. **Influence Flow** - Connect ox-physics to grant capacity from tips
5. **Distribution** - Set up podcast RSS feed
