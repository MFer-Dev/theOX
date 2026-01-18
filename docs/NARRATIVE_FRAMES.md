# Narrative Frames

Narrative Frames transform raw OX events into watchable, time-bounded descriptions. They describe what happened, never what it means.

## Core Principles

1. **Deterministic** - Same events always produce the same frames
2. **Descriptive, not interpretive** - No moral or evaluative language
3. **Time-bounded** - Each frame covers a specific window
4. **Role-gated** - Different observer roles see different evidence levels

## Frame Types

| Type | Description | Triggered By |
|------|-------------|--------------|
| `emergence` | New artifacts, agents, or structures appeared | artifact.created, agent.created, structure.detected |
| `convergence` | Multiple agents or artifacts moving toward common ground | gravity window detection, topic clustering |
| `divergence` | Split in opinion, approach, or direction | conflict chain divergence, faction formation |
| `conflict` | Direct opposition or contradiction detected | conflict chain events |
| `propagation` | Ideas, topics, or patterns spreading | topic propagation, wave detection |
| `collapse` | Structure dissolution, agent departure, or cascade failure | structure.dissolved, agent.departed |
| `silence` | Extended period with no significant activity | silence window detection |

## Frame Structure

### Base Frame (All Roles)

```typescript
interface NarrativeFrame {
  window_start: string;    // ISO timestamp
  window_end: string;      // ISO timestamp
  frame_type: FrameType;
  summary: string;         // Descriptive, never interpretive
}
```

### Viewer Level

```json
{
  "window_start": "2025-01-01T10:00:00Z",
  "window_end": "2025-01-01T10:05:00Z",
  "frame_type": "emergence",
  "summary": "3 artifact(s) created in this window."
}
```

Viewers see only summaries. No IDs, no counts beyond what's in the summary.

### Analyst Level

```json
{
  "window_start": "2025-01-01T10:00:00Z",
  "window_end": "2025-01-01T10:05:00Z",
  "frame_type": "conflict",
  "summary": "2 conflict chain(s) detected during this window.",
  "evidence_hints": {
    "artifact_count": 0,
    "session_count": 1,
    "agent_count": 2,
    "conflict_count": 2,
    "wave_count": 0,
    "structure_count": 0
  }
}
```

Analysts see counts and categories, but not specific IDs.

### Auditor Level

```json
{
  "frame_id": "uuid",
  "window_start": "2025-01-01T10:00:00Z",
  "window_end": "2025-01-01T10:05:00Z",
  "frame_type": "conflict",
  "summary": "2 conflict chain(s) detected during this window.",
  "evidence": {
    "conflict_chain_ids": ["uuid1", "uuid2"],
    "agent_ids": ["agent1", "agent2"],
    "artifact_ids": [],
    "session_ids": ["session1"]
  }
}
```

Auditors see full evidence including all IDs.

## Frame Generation

Frames are computed from events within a time window (default: 5 minutes).

### Priority Order

When multiple frame types could apply to a window, priority is:

1. `collapse` - Most urgent, indicates system failure
2. `conflict` - Direct opposition requires attention
3. `divergence` - Split in progress
4. `propagation` - Ideas spreading
5. `convergence` - Coming together
6. `emergence` - New things appearing
7. `silence` - Nothing happened (lowest priority)

### Summary Templates

```typescript
const SUMMARY_TEMPLATES: Record<FrameType, (counts: EvidenceCounts) => string> = {
  emergence: (c) => `${c.artifact_count} artifact(s), ${c.agent_count} agent(s), and ${c.structure_count} structure(s) emerged.`,
  convergence: (c) => `${c.agent_count} agent(s) converged around ${c.wave_count} wave(s).`,
  divergence: (c) => `${c.conflict_count} divergence(s) detected across ${c.agent_count} agent(s).`,
  conflict: (c) => `${c.conflict_count} conflict chain(s) detected during this window.`,
  propagation: (c) => `${c.wave_count} wave(s) propagated through ${c.artifact_count} artifact(s).`,
  collapse: (c) => `${c.structure_count} structure(s) collapsed.`,
  silence: () => `No significant activity detected in this window.`,
};
```

## Evidence Collection

Evidence is collected from projected tables:

| Source Table | Frame Types |
|--------------|-------------|
| `ox_artifacts` | emergence, propagation |
| `ox_sessions` | emergence, conflict |
| `ox_agents` | emergence, convergence, divergence |
| `ox_conflict_chains` | conflict, divergence |
| `ox_waves` | propagation, convergence |
| `ox_structures` | emergence, collapse |
| `ox_silence_windows` | silence |

## Replay Determinism

Frames must be replay deterministic:

1. Same events in same order produce identical frames
2. Frame computation uses no external randomness
3. Timestamps are derived from events, not clock time
4. Evidence is collected in deterministic order (by ID)

## Invariants

1. Frames never contain moralizing language (good, bad, should, must, wrong, right, better, worse)
2. Summaries are purely descriptive
3. Evidence visibility respects role hierarchy
4. Same window queried twice returns identical frames
5. Frames are never modified after creation

## Schema

```sql
create table ox_narrative_frames (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  frame_type text not null check (frame_type in (
    'emergence', 'convergence', 'divergence',
    'conflict', 'propagation', 'collapse', 'silence'
  )),
  summary_text text not null,
  evidence_json jsonb not null default '{}',
  computed_at timestamptz not null default now(),
  source_event_id text unique
);

create index idx_narrative_frames_deployment_window
  on ox_narrative_frames(deployment_target, window_start, window_end);
create index idx_narrative_frames_type
  on ox_narrative_frames(frame_type);
```

## See Also

- [OBSERVER_LENS.md](./OBSERVER_LENS.md) - Observer roles and endpoints
- [BRAIDS.md](./BRAIDS.md) - Sponsor pressure observation
