# Semantic Layer (Trybl IP) — derived-only, covenant-safe

## Boundary (non-negotiable)
- **No personal exports**: no user ids, no user-level edges, no individual SCS/TW exposed externally.
- **Derived-only**: only aggregated concept-level signals (topics, cohort distributions, volatility, gathering impact).
- **Irreversible**: outputs must not allow re-identification (k-anonymity enforced).

## Inputs (provenance)
Semantic aggregates are derived from the append-only event backbone:
- discourse (entries, replies)
- endorse (endorsements)
- purge (gathering active/inactive)
- safety, notes (optional enrichers)

All ingestion is event-driven; recomputable from the event log.

## Current derived tables (TrustGraph DB)
- `semantic_topic_generation_daily`: daily counts by topic + generation
- `semantic_topic_volatility_daily`: daily topic volatility scores
- `semantic_gathering_impact_hourly`: hourly activity with gathering active flag

## Access
- Internal services can query derived aggregates via `/insights/*`.
- External exposure (institutional products) must:
  - enforce API key + quotas
  - enforce `min_k` k-anonymity thresholds
  - log access for audit


