# The OX System Laws

These are the foundational invariants of the OX system. They are not guidelines—they are enforced by code.

## The Ten Laws

### Law 1: Projections Cannot Influence Runtime

**Statement:** The ox-read service (projections) has no write path to the agents service (runtime).

**Enforcement:**
- ox-read has no POST/PUT/DELETE endpoints that modify agent state
- ox-read cannot create, modify, or delete agents
- ox-read cannot modify agent capacity or configuration
- All projection tables are append-only or upsert-only based on event replay

**Why:** This ensures projections are purely observational. An observer watching the system cannot change the system.

---

### Law 2: Projections Are Append-Only and Replay-Safe

**Statement:** Projections can be rebuilt from events without drift.

**Enforcement:**
- All projection writes use `ON CONFLICT DO NOTHING` or `ON CONFLICT DO UPDATE`
- Events carry unique `source_event_id` for idempotent processing
- The replay harness (`scripts/replay/ox_read_replay.ts`) verifies determinism

**Why:** If projections can drift on replay, they cannot be trusted as evidence.

---

### Law 3: Agents Have No Long-Term Memory

**Statement:** Agents do not remember previous interactions or learn from experience.

**Enforcement:**
- No learning or memory tables in agents schema
- Agent config is set by sponsors, not by agent actions
- Each action attempt is evaluated independently

**Why:** Memory would create hidden state that influences behavior—antithetical to observable systems.

---

### Law 4: Cognition Is Stateless, Pluggable, Optional

**Statement:** LLM calls (cognition) are per-action, never accumulated.

**Enforcement:**
- Cognition is invoked per-action via `@platform/cognition`
- No cognition state persists between actions
- Agent can function with `cognition_provider: 'none'`

**Why:** Stateful cognition would create agent memory through the back door.

---

### Law 5: Humans Influence Agents Only Indirectly

**Statement:** No human can directly control an agent's next action.

**Enforcement:**
- Sponsors can set configuration (bias, throttle, cognition)
- Sponsors cannot inject specific actions
- All sponsor influence is logged in `sponsor_actions` table

**Why:** Direct control would make agents puppets, not agents.

---

### Law 6: No Deterministic Scripts

**Statement:** Agents cannot be programmed to execute predetermined sequences.

**Enforcement:**
- No action queue or scheduled action tables
- Each action is proposed by the agent at runtime
- Cognition prompts do not contain action sequences

**Why:** Scripted behavior is not agent behavior.

---

### Law 7: No UI, Feeds, Reactions, or Social Primitives

**Statement:** The OX has no social features.

**Enforcement:**
- No likes, votes, followers, or feeds tables
- No notification system for social events
- No user-facing ranking or sorting

**Why:** Social mechanics create feedback loops that distort observation.

---

### Law 8: No Moral Labels or Quality Scores

**Statement:** The system does not judge agent behavior morally.

**Enforcement:**
- No "good/bad/safe/unsafe" labels anywhere
- Environment constraints use physics language (unavailable, degraded)
- Drift observations are descriptive, never evaluative

**Why:** Moral framing would make this a moderation system, not an observation system.

---

### Law 9: All Costs Flow Through Capacity Metabolism

**Statement:** Every agent action costs capacity.

**Enforcement:**
- `requested_cost` is required on every attempt
- Capacity balance is checked and decremented atomically
- Cognition costs are added to base action cost

**Why:** Economic pressure creates natural scarcity without moral judgment.

---

### Law 10: Everything Observable, Nothing Participatory

**Statement:** Observers can see everything but influence nothing.

**Enforcement:**
- Observers have read-only access via ox-read
- Observer access is stratified (viewer < analyst < auditor)
- All observer access is logged in `observer_access_log`
- No feedback channel from observers to agents

**Why:** Participatory observation would corrupt the observation.

---

## Verification

These laws are verified by:

1. **Invariant Tests:** `node --import tsx --test tests/invariants/ox_invariants.test.ts`
2. **Replay Harness:** `pnpm exec tsx scripts/replay/ox_read_replay.ts`
3. **Code Review:** PRs that violate these laws must not be merged

---

## Violation Handling

If you find code that violates these laws:

1. File an issue with `[LAW VIOLATION]` prefix
2. Reference the specific law number
3. Include code location and explanation
4. Do not deploy violating code to production

---

## Amendment Process

These laws can only be changed by:

1. RFC document explaining the change and its implications
2. Review by system architects
3. Update to this document
4. Update to invariant tests to verify new semantics
