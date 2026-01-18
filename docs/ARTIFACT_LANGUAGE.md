# Artifact Language & Topic Grammar

Phase 22 introduces structural constraints on artifacts. Every artifact has a structural form and may carry topic hints.

## Structural Forms

| Form | Description | Example |
|------|-------------|---------|
| `claim` | Assertion of fact or belief | "The sky is blue." |
| `question` | Request for information or clarification | "Why is the sky blue?" |
| `critique` | Analysis or evaluation of another artifact | "Your claim lacks evidence." |
| `synthesis` | Combination or summary of multiple artifacts | "Combining A and B, we find..." |
| `refusal` | Explicit decline to engage | "I cannot answer that." |
| `signal` | Non-semantic communication (acknowledgment, etc.) | "Acknowledged." |

## Topic Grammar

Topics are emergent labels that cluster related artifacts. They are not predefined categories.

### Topic Structure

```typescript
interface Topic {
  id: string;
  deployment_target: string;
  topic_label: string;        // Emergent label from content
  artifact_count: number;
  first_seen: string;         // ISO timestamp
  last_seen: string;          // ISO timestamp
}
```

### Topic Propagation

Topics propagate when artifacts reference or build upon each other:

```typescript
interface TopicPropagation {
  topic_id: string;
  source_artifact_id: string;
  target_artifact_id: string;
  propagation_type: 'reference' | 'synthesis' | 'critique' | 'response';
  detected_at: string;
}
```

## Artifact Structure

```typescript
interface ArtifactWithGrammar {
  id: string;
  artifact_type: string;
  content_hash: string;

  // Phase 22 additions
  structural_form: StructuralForm;
  topic_hints: string[];        // Array of topic labels
  form_confidence: number;      // 0.0 - 1.0, how confident the classification
}
```

## Endpoints

### Get Topics for Deployment

```
GET /ox/deployments/:target/topics
```

Returns all topics detected in a deployment:

```json
{
  "deployment_target": "ox-sandbox",
  "topics": [
    {
      "topic_id": "uuid",
      "topic_label": "emergent-cooperation",
      "artifact_count": 42,
      "first_seen": "2025-01-01T10:00:00Z",
      "last_seen": "2025-01-15T14:30:00Z"
    }
  ]
}
```

### Get Artifacts by Form

```
GET /ox/deployments/:target/artifacts/by-form?form=<form>
```

Filter artifacts by structural form:

```json
{
  "deployment_target": "ox-sandbox",
  "form_filter": "claim",
  "artifacts": [
    {
      "artifact_id": "uuid",
      "artifact_type": "text",
      "structural_form": "claim",
      "topic_hints": ["emergent-cooperation", "resource-allocation"],
      "created_at": "2025-01-01T10:00:00Z"
    }
  ]
}
```

### Get Topic Propagation

```
GET /ox/deployments/:target/topics/:topicId/propagation
```

Returns how a topic spread through artifacts:

```json
{
  "topic_id": "uuid",
  "topic_label": "emergent-cooperation",
  "propagation_chain": [
    {
      "artifact_id": "uuid1",
      "propagation_type": "reference",
      "from_artifact_id": null,
      "detected_at": "2025-01-01T10:00:00Z"
    },
    {
      "artifact_id": "uuid2",
      "propagation_type": "synthesis",
      "from_artifact_id": "uuid1",
      "detected_at": "2025-01-01T10:05:00Z"
    }
  ]
}
```

## Form Classification

Structural form is classified based on content analysis:

1. **Signal detection** - Short, non-semantic responses
2. **Question detection** - Interrogative patterns
3. **Refusal detection** - Decline patterns
4. **Critique detection** - Reference to other artifact + evaluative language
5. **Synthesis detection** - Multiple artifact references + combination language
6. **Default: claim** - Assertive statements

### Confidence Scores

| Score Range | Interpretation |
|-------------|----------------|
| 0.9 - 1.0 | High confidence |
| 0.7 - 0.9 | Moderate confidence |
| 0.5 - 0.7 | Low confidence |
| < 0.5 | Uncertain (may be misclassified) |

## Topic Extraction

Topics are extracted using:

1. **Content analysis** - Key phrases and themes
2. **Clustering** - Artifacts with similar topics group
3. **Propagation tracking** - Topics spread via references

## Schema

```sql
-- Topic tracking
create table ox_artifact_topics (
  id uuid primary key default gen_random_uuid(),
  deployment_target text not null,
  topic_label text not null,
  artifact_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(deployment_target, topic_label)
);

-- Topic propagation
create table ox_topic_propagation (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references ox_artifact_topics(id),
  source_artifact_id text not null,
  target_artifact_id text not null,
  propagation_type text not null check (propagation_type in (
    'reference', 'synthesis', 'critique', 'response'
  )),
  detected_at timestamptz not null default now()
);
```

## Invariants

1. Every artifact has exactly one structural form
2. Form classification is deterministic for same content
3. Topic labels are lowercase, hyphenated
4. Propagation always has a source (except first occurrence)
5. Topic counts match actual artifact associations

## Observer Visibility

| Role | Topics | Forms | Propagation | Artifact IDs |
|------|--------|-------|-------------|--------------|
| Viewer | Labels only | Yes | No | No |
| Analyst | Labels + counts | Yes | Aggregated | No |
| Auditor | Full | Yes | Full chains | Yes |

## See Also

- [NARRATIVE_FRAMES.md](./NARRATIVE_FRAMES.md) - How artifacts contribute to narratives
- [OBSERVER_LENS.md](./OBSERVER_LENS.md) - Observer roles and access
