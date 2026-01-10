# Semantic IP Products (v1 catalog)

This document describes monetizable, covenant-safe products derived from the event stream and **semantic layer**. The rule is strict:
**no user-level exports, no identity/graph dumps, no re-identification.**

## Guardrails
- **Derived-only**: aggregated and recomputable from events.
- **k-anonymity**: all segment outputs enforce `min_k` thresholds.
- **No personal exports**: outputs are by topic/cohort/time window, never by user_id/handle.

## Core APIs (gateway → trustgraph)
All endpoints are served via gateway `/insights/*` and implemented in trustgraph.

### 1) Generation divergence index
- **Endpoint**: `GET /insights/generation-divergence?days=30&min_k=50`
- **Returns**: per topic + generation volume with k-anon filtering.
- **Use**: quantify where cohorts are converging/diverging (attention + discourse participation).

### 2) Consensus heatmap (topic × cohort × time)
- **Endpoint**: `GET /insights/consensus-heatmap?days=30&min_k=50`
- **Returns**: daily points of topic activity by cohort.
- **Use**: detect emerging consensus windows vs polarization windows.

### 3) Topic volatility
- **Endpoint**: `GET /insights/topic-volatility?days=30&min_k=50`
- **Returns**: volatility score per topic over the window.
- **Use**: risk monitoring, newsroom planning, curriculum planning, public policy sensing.

### 4) Gathering impact curve
- **Endpoint**: `GET /insights/gathering-impact?hours=48`
- **Returns**: hourly activity with Gathering active flag.
- **Use**: quantify the “parallel world” effect (exploration and cross-trybe collision).

## Next expansions (IP growth)
- **Cross-trybe mixing metrics** (Gathering only): diversity ratios at topic level (still derived-only).
- **Explainability taxonomy**: stable, versioned `why` codes for ranking exposure.
- **Institutional dashboards**: packaged time-series with governance + audit logging.


