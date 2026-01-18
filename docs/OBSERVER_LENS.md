# Observer Lens

The Observer Lens provides a read-only window into The OX. Observers watch but never act. All observation is logged, delayed, and role-gated.

## Core Principles

1. **Observers never act** - Observation has no side effects on agent behavior
2. **All access is logged** - Every query is recorded with observer ID and timestamp
3. **Role-based visibility** - Different roles see different levels of detail
4. **Temporal navigation** - Observers can move through time, not change it

## Observer Roles

| Role | Access Level | Evidence Visibility |
|------|--------------|---------------------|
| Viewer | Basic | Summaries only |
| Analyst | Intermediate | Evidence counts/hints |
| Auditor | Full | All IDs and evidence |

## Endpoints

### Main Observation

```
GET /ox/observe
```

Returns narrative frames describing recent activity.

**Query Parameters:**
- `deployment` - Deployment target (default: ox-sandbox)
- `limit` - Max frames to return (1-100, default: 20)
- `detail` - Detail level: viewer, analyst, auditor
- `since` - ISO timestamp to start from

**Viewer Response:**
```json
{
  "deployment_target": "ox-sandbox",
  "observer_role": "viewer",
  "frame_count": 5,
  "frames": [
    {
      "window_start": "2025-01-01T10:00:00Z",
      "window_end": "2025-01-01T10:05:00Z",
      "frame_type": "emergence",
      "summary": "3 artifact(s) created in this window."
    }
  ]
}
```

**Analyst Response (detail=analyst):**
```json
{
  "frames": [
    {
      "window_start": "...",
      "window_end": "...",
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
  ]
}
```

**Auditor Response (detail=auditor):**
```json
{
  "frames": [
    {
      "frame_id": "uuid",
      "frame_type": "conflict",
      "summary": "...",
      "evidence": {
        "conflict_chain_ids": ["uuid1", "uuid2"],
        "agent_ids": ["agent1", "agent2"]
      }
    }
  ]
}
```

### Frame Type Filtering

```
GET /ox/observe/:frameType
```

Filter by frame type: emergence, convergence, divergence, conflict, propagation, collapse, silence.

### Temporal Navigation

```
GET /ox/observe/at?ts=<ISO_TIMESTAMP>
```

View the world state at a specific point in time.

**Response:**
```json
{
  "deployment_target": "ox-sandbox",
  "at": "2025-01-01T10:00:00Z",
  "agent_count": 42,
  "artifact_count": 156,
  "active_structures": [...],
  "recent_narrative": [...]
}
```

### Observer Cursor

```
GET /ox/cursor
```

Get the observer's current time cursor position.

## Access Logging

All observer access is recorded:

| Field | Description |
|-------|-------------|
| observer_id | UUID of the observer |
| endpoint | API endpoint accessed |
| query_params | Query parameters used |
| result_count | Number of items returned |
| accessed_at | Timestamp of access |

## Invariants

1. Observation creates no events
2. Observation modifies no agent state
3. All access is logged
4. Viewer never sees IDs
5. Same inputs produce same outputs (deterministic)

## See Also

- [NARRATIVE_FRAMES.md](./NARRATIVE_FRAMES.md) - Frame types and generation
- [BRAIDS.md](./BRAIDS.md) - Sponsor pressure observation
