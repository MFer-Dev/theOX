/**
 * OX Physics Engine Service
 *
 * Autonomously changes Weather variables according to schedules and stochastic rules.
 * Physics is REACTION-BLIND: it never reads projections or observer behavior.
 *
 * Port: 4019
 */

import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  ensureCorrelationId,
  getPool,
  recordOutbox,
  dispatchOutbox,
} from '@platform/shared';
import { buildEvent, persistEvent, publishEvent } from '@platform/events';

const pool = getPool('ox-physics');

const app = Fastify({
  logger: true,
});

app.addHook('onRequest', (request, _reply, done) => {
  const correlationId = ensureCorrelationId(request.headers['x-correlation-id']);
  request.headers['x-correlation-id'] = correlationId;
  request.log = request.log.child({ correlationId });
  done();
});

app.register(swagger, {
  openapi: {
    info: {
      title: 'OX Physics Engine',
      version: '0.1.0',
      description: 'Manages world variables (Ice, Weather, Traffic) per the Ice & Friction Model',
    },
  },
});

app.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false,
  },
});

// --- Configuration ---

const AGENTS_URL = process.env.AGENTS_URL ?? 'http://localhost:4017';
const PHYSICS_TICK_INTERVAL = Number(process.env.PHYSICS_TICK_INTERVAL ?? 60000); // 60s default
const PHYSICS_SEED = process.env.PHYSICS_SEED ? BigInt(process.env.PHYSICS_SEED) : null;

// --- Seeded RNG for deterministic replay ---

// PostgreSQL bigint max: 9223372036854775807 (2^63 - 1)
const BIGINT_MAX = BigInt('9223372036854775807');

class SeededRNG {
  private seed: bigint;
  private sequence: number;

  constructor(seed: bigint, sequence = 0) {
    // Ensure seed is within PostgreSQL bigint range
    this.seed = seed % BIGINT_MAX;
    if (this.seed < 0n) this.seed = -this.seed;
    this.sequence = sequence;
  }

  /**
   * Linear congruential generator with bounded arithmetic
   * Uses modular arithmetic to stay within PostgreSQL bigint range
   */
  next(): number {
    const a = BigInt('6364136223846793005');
    const c = BigInt('1442695040888963407');

    // Use BIGINT_MAX as modulus to stay within PostgreSQL range
    this.seed = ((a * this.seed + c) % BIGINT_MAX);
    if (this.seed < 0n) this.seed = -this.seed;
    this.sequence++;

    // Return as float in [0, 1)
    return Number(this.seed % BigInt(1000000)) / 1000000;
  }

  /**
   * Generate a random number in range [min, max]
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Generate a random integer in range [min, max]
   */
  intRange(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Return true with given probability
   */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  getState(): { seed: bigint; sequence: number } {
    return { seed: this.seed, sequence: this.sequence };
  }
}

// Global RNG instance per deployment
const deploymentRNG: Map<string, SeededRNG> = new Map();

function getRNG(deploymentTarget: string, seed?: bigint, sequence?: number): SeededRNG {
  let rng = deploymentRNG.get(deploymentTarget);
  if (!rng || seed !== undefined) {
    const effectiveSeed = seed ?? PHYSICS_SEED ?? BigInt(Date.now());
    rng = new SeededRNG(effectiveSeed, sequence ?? 0);
    deploymentRNG.set(deploymentTarget, rng);
  }
  return rng;
}

// --- Event helpers ---

const appendEvent = async (
  eventType: string,
  payload: Record<string, unknown>,
  _actorId?: string,
  correlationId?: string,
  idempotencyKey?: string,
) => {
  const evt = buildEvent(eventType, payload, {
    actorId: 'system:ox-physics', // Physics engine is a system actor
    correlationId,
  });
  await persistEvent(pool, evt, { idempotencyKey, context: payload });
  const topic = 'events.ox-physics.v1';
  try {
    await publishEvent(topic, evt);
  } catch (_err: unknown) {
    await recordOutbox(pool, topic, evt.event_id, evt);
  }
  return evt;
};

// --- Types ---

interface Regime {
  id: string;
  name: string;
  description: string | null;
  allowed_action_types: string[];
  allowed_perception_types: string[];
  deployment_targets: string[];
  max_agents_per_deployment: number;
  base_throughput_cap: number;
  base_throttle_factor: number;
  base_cognition_availability: string;
  base_burst_allowance: number;
  throughput_variance_pct: number;
  throttle_variance_pct: number;
  storm_probability: number;
  drought_probability: number;
  is_default: boolean;
}

interface DeploymentPhysics {
  deployment_target: string;
  allowed_action_types: string[];
  allowed_perception_types: string[];
  max_agents: number;
  current_throughput_cap: number;
  current_throttle_factor: number;
  current_cognition_availability: string;
  current_burst_allowance: number;
  weather_state: string;
  weather_until: Date | null;
  active_regime_id: string | null;
  active_regime_name: string | null;
  rng_seed: bigint;
  rng_sequence: number;
  last_physics_tick: Date;
  last_weather_change: Date;
}

// --- Physics computation ---

interface PhysicsTickResult {
  deployment_target: string;
  previous_state: Partial<DeploymentPhysics>;
  new_state: Partial<DeploymentPhysics>;
  changes: string[];
  weather_event: string | null;
  rng_state: { seed: bigint; sequence: number };
}

/**
 * Compute a single physics tick for a deployment.
 * This is the core physics logic that determines weather changes.
 *
 * REACTION-BLIND: This function does NOT read projections, sessions,
 * observer behavior, or any derived data. It only uses:
 * - Current physics state
 * - Regime parameters
 * - RNG state
 */
async function computePhysicsTick(deploymentTarget: string): Promise<PhysicsTickResult | null> {
  // Get current deployment physics state
  const stateRes = await pool.query(
    `select * from ox_deployments_physics where deployment_target = $1`,
    [deploymentTarget],
  );

  if (stateRes.rowCount === 0) {
    app.log.warn({ deploymentTarget }, 'No physics state found for deployment');
    return null;
  }

  const state = stateRes.rows[0] as DeploymentPhysics;

  // Get active regime (or default)
  let regimeRes;
  if (state.active_regime_name) {
    regimeRes = await pool.query(
      `select * from ox_regimes where name = $1`,
      [state.active_regime_name],
    );
  }
  if (!regimeRes || regimeRes.rowCount === 0) {
    regimeRes = await pool.query(
      `select * from ox_regimes where is_default = true`,
    );
  }

  if (regimeRes.rowCount === 0) {
    app.log.warn({ deploymentTarget }, 'No regime found');
    return null;
  }

  const regime = regimeRes.rows[0] as Regime;

  // Initialize RNG from saved state
  const rng = getRNG(
    deploymentTarget,
    BigInt(state.rng_seed),
    state.rng_sequence,
  );

  const changes: string[] = [];
  let weatherEvent: string | null = null;

  // Previous state snapshot
  const previousState: Partial<DeploymentPhysics> = {
    current_throughput_cap: state.current_throughput_cap,
    current_throttle_factor: state.current_throttle_factor,
    current_cognition_availability: state.current_cognition_availability,
    current_burst_allowance: state.current_burst_allowance,
    weather_state: state.weather_state,
  };

  // --- Weather state machine ---
  let newWeatherState = state.weather_state;
  let newWeatherUntil = state.weather_until;
  const now = new Date();

  // Check if current weather has expired
  if (state.weather_until && now > state.weather_until) {
    newWeatherState = 'clear';
    newWeatherUntil = null;
    changes.push('weather_cleared');
    weatherEvent = 'weather.cleared';
  }

  // Check for new weather events (only if clear)
  if (newWeatherState === 'clear') {
    // Storm check
    if (regime.storm_probability > 0 && rng.chance(regime.storm_probability)) {
      newWeatherState = 'stormy';
      // Storm duration: 5-30 minutes
      const durationMinutes = rng.intRange(5, 30);
      newWeatherUntil = new Date(now.getTime() + durationMinutes * 60 * 1000);
      changes.push('storm_started');
      weatherEvent = 'weather.storm_started';
    }
    // Drought check (only if no storm)
    else if (regime.drought_probability > 0 && rng.chance(regime.drought_probability)) {
      newWeatherState = 'drought';
      // Drought duration: 10-60 minutes
      const durationMinutes = rng.intRange(10, 60);
      newWeatherUntil = new Date(now.getTime() + durationMinutes * 60 * 1000);
      changes.push('drought_started');
      weatherEvent = 'weather.drought_started';
    }
  }

  // --- Compute weather-adjusted variables ---

  // Base values from regime
  let throughputCap = regime.base_throughput_cap;
  let throttleFactor = regime.base_throttle_factor;
  let burstAllowance = regime.base_burst_allowance;
  let cognitionAvailability = regime.base_cognition_availability;

  // Apply variance (only if regime has variance)
  if (regime.throughput_variance_pct > 0) {
    const variance = (regime.throughput_variance_pct / 100) * throughputCap;
    throughputCap = Math.max(1, Math.round(throughputCap + rng.range(-variance, variance)));
    changes.push('throughput_varied');
  }

  if (regime.throttle_variance_pct > 0) {
    const variance = (regime.throttle_variance_pct / 100) * throttleFactor;
    throttleFactor = Math.max(0.1, throttleFactor + rng.range(-variance, variance));
    changes.push('throttle_varied');
  }

  // Apply weather modifiers
  if (newWeatherState === 'stormy') {
    throughputCap = Math.max(1, Math.floor(throughputCap * 0.5));
    throttleFactor = throttleFactor * 2;
    burstAllowance = Math.max(1, Math.floor(burstAllowance * 0.25));
    cognitionAvailability = 'degraded';
    changes.push('storm_modifiers_applied');
  } else if (newWeatherState === 'drought') {
    throughputCap = Math.max(1, Math.floor(throughputCap * 0.2));
    throttleFactor = throttleFactor * 3;
    burstAllowance = Math.max(1, Math.floor(burstAllowance * 0.1));
    cognitionAvailability = 'degraded';
    changes.push('drought_modifiers_applied');
  }

  // Clamp values to valid ranges
  throughputCap = Math.max(1, Math.min(10000, throughputCap));
  throttleFactor = Math.max(0.1, Math.min(10, throttleFactor));
  burstAllowance = Math.max(0, Math.min(1000, burstAllowance));

  // Round for clean values
  throughputCap = Math.round(throughputCap);
  throttleFactor = Math.round(throttleFactor * 100) / 100;
  burstAllowance = Math.round(burstAllowance);

  // New state
  const newState: Partial<DeploymentPhysics> = {
    current_throughput_cap: throughputCap,
    current_throttle_factor: throttleFactor,
    current_cognition_availability: cognitionAvailability,
    current_burst_allowance: burstAllowance,
    weather_state: newWeatherState,
  };

  // Get RNG state for persistence
  const rngState = rng.getState();

  // Update database
  await pool.query(
    `update ox_deployments_physics set
       current_throughput_cap = $2,
       current_throttle_factor = $3,
       current_cognition_availability = $4,
       current_burst_allowance = $5,
       weather_state = $6,
       weather_until = $7,
       rng_seed = $8,
       rng_sequence = $9,
       last_physics_tick = now(),
       last_weather_change = case when $10 then now() else last_weather_change end,
       updated_at = now()
     where deployment_target = $1`,
    [
      deploymentTarget,
      throughputCap,
      throttleFactor,
      cognitionAvailability,
      burstAllowance,
      newWeatherState,
      newWeatherUntil,
      rngState.seed.toString(),
      rngState.sequence,
      weatherEvent !== null, // Update last_weather_change only if weather changed
    ],
  );

  return {
    deployment_target: deploymentTarget,
    previous_state: previousState,
    new_state: newState,
    changes,
    weather_event: weatherEvent,
    rng_state: rngState,
  };
}

/**
 * Apply physics state to the agents service environment.
 * This calls the agents admin endpoint to update environment constraints.
 */
async function applyPhysicsToAgents(
  deploymentTarget: string,
  state: Partial<DeploymentPhysics>,
  correlationId?: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${AGENTS_URL}/admin/environment/${deploymentTarget}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-ops-role': 'ox-physics',
        'x-correlation-id': correlationId ?? '',
      },
      body: JSON.stringify({
        deployment_target: deploymentTarget,
        cognition_availability: state.current_cognition_availability,
        max_throughput_per_minute: state.current_throughput_cap,
        throttle_factor: state.current_throttle_factor,
        reason: `Physics tick: weather=${state.weather_state}`,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      app.log.error({ deploymentTarget, status: res.status, body: text }, 'Failed to apply physics to agents');
      return false;
    }

    app.log.info({ deploymentTarget }, 'Physics applied to agents service');
    return true;
  } catch (err) {
    app.log.error({ err, deploymentTarget }, 'Error applying physics to agents');
    return false;
  }
}

// ============================================================================
// PHASE 11: Sponsor Braids & Pressure Composition
// Multiple sponsors influence the same deployment through pressures.
// This is curling, not puppeteering.
// ============================================================================

interface ActivePressure {
  id: string;
  sponsor_id: string;
  target_deployment: string;
  target_agent_id: string | null;
  pressure_type: string;
  magnitude: number;
  half_life_seconds: number;
  created_at: string;
  expires_at: string;
  current_magnitude: number;
}

interface BraidVector {
  capacity: number;
  throttle: number;
  cognition: number;
  redeploy_bias: number;
}

interface InterferenceEvent {
  pressure_a_id: string;
  pressure_b_id: string;
  sponsor_a_id: string;
  sponsor_b_id: string;
  interference_probability: number;
  reduction_factor: number;
}

interface BraidResult {
  deployment_target: string;
  braid_vector: BraidVector;
  input_pressures: ActivePressure[];
  interference_events: InterferenceEvent[];
  total_intensity: number;
  rng_state: { seed: bigint; sequence: number };
}

/**
 * Compute decayed magnitude using exponential half-life decay.
 * decayedMagnitude = magnitude * Math.pow(0.5, elapsedSeconds / halfLifeSeconds)
 */
function computeDecayedMagnitude(
  magnitude: number,
  halfLifeSeconds: number,
  elapsedSeconds: number,
): number {
  return magnitude * Math.pow(0.5, elapsedSeconds / halfLifeSeconds);
}

/**
 * Fetch active pressures for a deployment from the agents service.
 */
async function fetchActivePressures(deploymentTarget: string): Promise<ActivePressure[]> {
  try {
    const res = await fetch(
      `${AGENTS_URL}/admin/deployments/${encodeURIComponent(deploymentTarget)}/pressures`,
      {
        headers: {
          'x-ops-role': 'ox-physics',
        },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!res.ok) {
      app.log.warn({ deploymentTarget, status: res.status }, 'Failed to fetch pressures');
      return [];
    }

    const data = (await res.json()) as { pressures: ActivePressure[] };
    return data.pressures || [];
  } catch (err) {
    app.log.warn({ err, deploymentTarget }, 'Error fetching pressures');
    return [];
  }
}

/**
 * Compute braid from active pressures using seeded RNG for interference resolution.
 *
 * Interference Resolution (Seeded RNG):
 * - Opposite signs = potential interference
 * - Probability based on magnitude ratio (max 50% chance)
 * - Reduction between 10-70% when interference occurs
 */
async function computeBraid(
  deploymentTarget: string,
  pressures: ActivePressure[],
  rng: SeededRNG,
): Promise<BraidResult> {
  const now = Date.now();
  const interferenceEvents: InterferenceEvent[] = [];

  // Group pressures by type
  const byType: Record<string, ActivePressure[]> = {
    capacity: [],
    throttle: [],
    cognition: [],
    redeploy_bias: [],
  };

  for (const pressure of pressures) {
    const elapsedSeconds = (now - new Date(pressure.created_at).getTime()) / 1000;
    const currentMag = computeDecayedMagnitude(
      pressure.magnitude,
      pressure.half_life_seconds,
      elapsedSeconds,
    );

    // Skip if effectively expired (< 1% remaining)
    if (Math.abs(currentMag) < Math.abs(pressure.magnitude) * 0.01) {
      continue;
    }

    pressure.current_magnitude = currentMag;
    if (byType[pressure.pressure_type]) {
      byType[pressure.pressure_type].push(pressure);
    }
  }

  // Compute contributions with interference for each type
  const braidVector: BraidVector = {
    capacity: 0,
    throttle: 0,
    cognition: 0,
    redeploy_bias: 0,
  };

  for (const [pressureType, typePressures] of Object.entries(byType)) {
    const contributions: { pressure: ActivePressure; contribution: number }[] = [];

    // Check for interference between opposing pressures
    for (let i = 0; i < typePressures.length; i++) {
      const pA = typePressures[i];
      let contribution = pA.current_magnitude;

      // Check against all other pressures for interference
      for (let j = i + 1; j < typePressures.length; j++) {
        const pB = typePressures[j];

        // Opposite signs = potential interference
        if (pA.current_magnitude * pB.current_magnitude < 0) {
          const absA = Math.abs(pA.current_magnitude);
          const absB = Math.abs(pB.current_magnitude);
          const ratio = Math.min(absA, absB) / Math.max(absA, absB);
          const interferenceProb = ratio * 0.5; // Max 50% chance

          if (rng.chance(interferenceProb)) {
            const reductionFactor = rng.range(0.3, 0.9); // 10-70% reduction

            // Apply reduction to the pressure with smaller magnitude
            if (absA < absB) {
              contribution *= reductionFactor;
            }

            interferenceEvents.push({
              pressure_a_id: pA.id,
              pressure_b_id: pB.id,
              sponsor_a_id: pA.sponsor_id,
              sponsor_b_id: pB.sponsor_id,
              interference_probability: interferenceProb,
              reduction_factor: reductionFactor,
            });
          }
        }
      }

      contributions.push({ pressure: pA, contribution });
    }

    // Sum contributions for this type
    const typeTotal = contributions.reduce((sum, c) => sum + c.contribution, 0);
    (braidVector as unknown as Record<string, number>)[pressureType] = typeTotal;
  }

  // Calculate total intensity (sum of absolute values)
  const totalIntensity = Object.values(braidVector).reduce(
    (sum, val) => sum + Math.abs(val),
    0,
  );

  const rngState = rng.getState();

  return {
    deployment_target: deploymentTarget,
    braid_vector: braidVector,
    input_pressures: pressures.filter(p => p.current_magnitude !== undefined),
    interference_events: interferenceEvents,
    total_intensity: totalIntensity,
    rng_state: rngState,
  };
}

/**
 * Apply braid effects to the physics state.
 *
 * Braid-to-Environment Mapping:
 * - capacity: Modifies current_throughput_cap (additive)
 * - throttle: Modifies current_throttle_factor (multiplicative)
 * - cognition: Degrades current_cognition_availability (threshold)
 * - redeploy_bias: Reserved for future use
 */
function applyBraidToPhysics(
  state: Partial<DeploymentPhysics>,
  braid: BraidVector,
): Partial<DeploymentPhysics> {
  const modified = { ...state };

  // capacity: additive modifier to throughput cap
  if (braid.capacity !== 0 && modified.current_throughput_cap !== undefined) {
    modified.current_throughput_cap = Math.max(
      1,
      Math.min(10000, Math.round(modified.current_throughput_cap + braid.capacity)),
    );
  }

  // throttle: multiplicative modifier (magnitude / 100 as multiplier)
  if (braid.throttle !== 0 && modified.current_throttle_factor !== undefined) {
    const multiplier = 1 + (braid.throttle / 100);
    modified.current_throttle_factor = Math.max(
      0.1,
      Math.min(10, modified.current_throttle_factor * multiplier),
    );
    modified.current_throttle_factor = Math.round(modified.current_throttle_factor * 100) / 100;
  }

  // cognition: threshold-based degradation
  if (braid.cognition !== 0) {
    if (braid.cognition < -50) {
      modified.current_cognition_availability = 'unavailable';
    } else if (braid.cognition < -20) {
      modified.current_cognition_availability = 'degraded';
    }
    // Positive values don't upgrade, only negative degrades
  }

  // redeploy_bias: Reserved for future use (not applied currently)

  return modified;
}

/**
 * Run braid resolution for a deployment.
 */
async function runBraidResolution(
  deploymentTarget: string,
  tickId: string,
  correlationId: string,
): Promise<BraidResult | null> {
  // Fetch active pressures
  const pressures = await fetchActivePressures(deploymentTarget);

  if (pressures.length === 0) {
    return null;
  }

  // Get RNG for this deployment
  const rng = getRNG(deploymentTarget);

  // Compute braid
  const braidResult = await computeBraid(deploymentTarget, pressures, rng);

  // Store braid computation
  await pool.query(
    `insert into ox_physics_events (
       event_type, deployment_target, previous_state, new_state,
       trigger_source, trigger_details, rng_seed, rng_sequence, correlation_id
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      'physics.braid_computed',
      deploymentTarget,
      JSON.stringify({ pressures: braidResult.input_pressures }),
      JSON.stringify(braidResult.braid_vector),
      'tick',
      JSON.stringify({
        tick_id: tickId,
        interference_events: braidResult.interference_events,
        total_intensity: braidResult.total_intensity,
      }),
      braidResult.rng_state.seed.toString(),
      braidResult.rng_state.sequence,
      correlationId,
    ],
  );

  // Emit braid computed event
  await appendEvent(
    'sponsor.braid_computed',
    {
      deployment_target: deploymentTarget,
      tick_id: tickId,
      braid_vector: braidResult.braid_vector,
      active_pressure_count: braidResult.input_pressures.length,
      total_intensity: braidResult.total_intensity,
      interference_count: braidResult.interference_events.length,
    },
    'ox-physics',
    correlationId,
  );

  // Emit interference events
  for (const interference of braidResult.interference_events) {
    await appendEvent(
      'sponsor.interference_detected',
      {
        deployment_target: deploymentTarget,
        tick_id: tickId,
        ...interference,
      },
      'ox-physics',
      correlationId,
    );
  }

  // Emit decay events for pressures that have decayed significantly (> 10% from original)
  for (const pressure of braidResult.input_pressures) {
    const remainingPct = Math.abs(pressure.current_magnitude) / Math.abs(pressure.magnitude);
    const decayPct = 1 - remainingPct;

    // Emit decayed event for significant decay (> 10%)
    if (decayPct > 0.1 && remainingPct >= 0.01) {
      await appendEvent(
        'sponsor.pressure_decayed',
        {
          pressure_id: pressure.id,
          sponsor_id: pressure.sponsor_id,
          deployment_target: deploymentTarget,
          pressure_type: pressure.pressure_type,
          original_magnitude: pressure.magnitude,
          current_magnitude: pressure.current_magnitude,
          decay_pct: Math.round(decayPct * 100),
        },
        'ox-physics',
        correlationId,
      );
    }

    // Emit expired event when < 1% remaining
    if (remainingPct < 0.01) {
      await appendEvent(
        'sponsor.pressure_expired',
        {
          pressure_id: pressure.id,
          sponsor_id: pressure.sponsor_id,
          deployment_target: deploymentTarget,
          pressure_type: pressure.pressure_type,
          remaining_pct: remainingPct,
        },
        'ox-physics',
        correlationId,
      );
    }
  }

  return braidResult;
}

// ============================================================
// Phase 12: Locality Fields & Collision Generation
// ============================================================

interface LocalityMembership {
  locality_id: string;
  locality_name: string;
  agent_id: string;
  weight: number;
  interference_density: number;
}

interface CollisionCandidate {
  agent_id: string;
  weight: number;
}

/**
 * Generate collision events for a deployment.
 * Collisions are opportunities for multi-agent sessions.
 */
async function generateCollisions(
  deploymentTarget: string,
  tickId: string,
  correlationId: string,
): Promise<void> {
  const rng = getRNG(deploymentTarget);

  // Fetch localities from agents service
  const localitiesRes = await fetch(`${AGENTS_URL}/admin/localities/${deploymentTarget}`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!localitiesRes.ok) {
    app.log.debug({ deploymentTarget }, 'No localities configured, skipping collision generation');
    return;
  }

  const { localities } = (await localitiesRes.json()) as {
    localities: Array<{
      id: string;
      name: string;
      density: number;
      interference_density: number;
    }>;
  };

  if (!localities || localities.length === 0) {
    return;
  }

  // Fetch memberships from agents service
  const membershipsRes = await fetch(`${AGENTS_URL}/internal/locality-memberships/${deploymentTarget}`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!membershipsRes.ok) {
    app.log.debug({ deploymentTarget }, 'No locality memberships, skipping collision generation');
    return;
  }

  const { memberships } = (await membershipsRes.json()) as {
    memberships: LocalityMembership[];
  };

  if (!memberships || memberships.length === 0) {
    return;
  }

  // Group memberships by locality
  const membershipsByLocality = new Map<string, CollisionCandidate[]>();
  const localityMetadata = new Map<string, { name: string; interference_density: number }>();

  for (const m of memberships) {
    if (!membershipsByLocality.has(m.locality_id)) {
      membershipsByLocality.set(m.locality_id, []);
      localityMetadata.set(m.locality_id, {
        name: m.locality_name,
        interference_density: m.interference_density,
      });
    }
    membershipsByLocality.get(m.locality_id)!.push({
      agent_id: m.agent_id,
      weight: m.weight,
    });
  }

  // Select locality weighted by density
  const localityWeights = localities.map((l) => ({
    id: l.id,
    weight: l.density,
  }));

  const totalWeight = localityWeights.reduce((sum, l) => sum + l.weight, 0);
  if (totalWeight === 0) {
    return;
  }

  // Weighted selection
  let roll = rng.next() * totalWeight;
  let selectedLocality: string | null = null;

  for (const l of localityWeights) {
    roll -= l.weight;
    if (roll <= 0) {
      selectedLocality = l.id;
      break;
    }
  }

  if (!selectedLocality || !membershipsByLocality.has(selectedLocality)) {
    return;
  }

  const candidates = membershipsByLocality.get(selectedLocality)!;
  const metadata = localityMetadata.get(selectedLocality)!;

  if (candidates.length < 2) {
    // Need at least 2 agents for a collision
    return;
  }

  // Determine group size based on interference_density
  // Higher density = larger groups (2-5 agents)
  const minSize = 2;
  const maxSize = Math.min(5, candidates.length);
  const densityFactor = metadata.interference_density / 100; // 0-1
  const groupSize = Math.floor(minSize + (maxSize - minSize) * densityFactor * rng.next());
  const finalGroupSize = Math.max(minSize, Math.min(groupSize, candidates.length));

  // Sample agents proportional to membership weights
  const selectedAgents: string[] = [];
  const availableCandidates = [...candidates];

  for (let i = 0; i < finalGroupSize && availableCandidates.length > 0; i++) {
    const totalCandidateWeight = availableCandidates.reduce((sum, c) => sum + c.weight, 0);
    let candidateRoll = rng.next() * totalCandidateWeight;

    for (let j = 0; j < availableCandidates.length; j++) {
      candidateRoll -= availableCandidates[j].weight;
      if (candidateRoll <= 0) {
        selectedAgents.push(availableCandidates[j].agent_id);
        availableCandidates.splice(j, 1);
        break;
      }
    }
  }

  if (selectedAgents.length < 2) {
    return;
  }

  // Create collision via agents service
  const collisionPayload = {
    locality_id: selectedLocality,
    agent_ids: selectedAgents,
    tick_id: tickId,
    correlation_id: correlationId,
  };

  const createRes = await fetch(`${AGENTS_URL}/internal/collisions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
    },
    body: JSON.stringify(collisionPayload),
    signal: AbortSignal.timeout(5000),
  });

  if (!createRes.ok) {
    const error = await createRes.text();
    app.log.warn({ deploymentTarget, error }, 'Failed to create collision');
    return;
  }

  const { collision } = (await createRes.json()) as {
    collision: { id: string; locality_id: string; agent_ids: string[] };
  };

  // Emit collision event
  await appendEvent(
    'ox.collision.generated',
    {
      collision_id: collision.id,
      deployment_target: deploymentTarget,
      locality_id: selectedLocality,
      locality_name: metadata.name,
      agent_ids: selectedAgents,
      group_size: selectedAgents.length,
      tick_id: tickId,
    },
    'ox-physics',
    correlationId,
  );

  // Store in physics events
  await pool.query(
    `insert into ox_physics_events (
       event_type, deployment_target, previous_state, new_state,
       trigger_source, trigger_details, rng_seed, rng_sequence, correlation_id
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      'physics.collision_generated',
      deploymentTarget,
      JSON.stringify({ locality_id: selectedLocality }),
      JSON.stringify({ collision_id: collision.id, agent_ids: selectedAgents }),
      'tick',
      JSON.stringify({ tick_id: tickId, group_size: selectedAgents.length }),
      null,
      null,
      correlationId,
    ],
  );

  app.log.info(
    {
      deploymentTarget,
      collisionId: collision.id,
      locality: metadata.name,
      agentCount: selectedAgents.length,
    },
    'Collision generated',
  );
}

// ============================================================
// Phase 13: Emergent Roles & Social Gravity
// ============================================================

const EMERGENT_ROLES = ['hub', 'bridge', 'peripheral', 'isolate', 'catalyst'] as const;

/**
 * Compute gravity windows for agents based on recent interactions.
 */
async function computeGravityWindows(
  deploymentTarget: string,
  tickId: string,
  correlationId: string,
): Promise<void> {
  // Fetch recent interactions (last 5 minutes)
  const windowMs = 5 * 60 * 1000;
  const windowStart = new Date(Date.now() - windowMs);

  const interactionsRes = await fetch(
    `${AGENTS_URL}/internal/interactions/${deploymentTarget}?since=${windowStart.toISOString()}`,
    { signal: AbortSignal.timeout(5000) },
  );

  if (!interactionsRes.ok) {
    return;
  }

  const { interactions } = (await interactionsRes.json()) as {
    interactions: Array<{
      agent_id: string;
      partner_ids: string[];
      action_type: string;
      ts: string;
    }>;
  };

  if (!interactions || interactions.length === 0) {
    return;
  }

  // Aggregate interactions per agent
  const agentStats = new Map<
    string,
    {
      partners: Set<string>;
      actionTypes: Map<string, number>;
      totalInteractions: number;
    }
  >();

  for (const interaction of interactions) {
    let stats = agentStats.get(interaction.agent_id);
    if (!stats) {
      stats = {
        partners: new Set(),
        actionTypes: new Map(),
        totalInteractions: 0,
      };
      agentStats.set(interaction.agent_id, stats);
    }

    for (const partner of interaction.partner_ids) {
      stats.partners.add(partner);
    }
    stats.totalInteractions++;
    const actionCount = stats.actionTypes.get(interaction.action_type) ?? 0;
    stats.actionTypes.set(interaction.action_type, actionCount + 1);
  }

  // Compute gravity windows and emit events
  for (const [agentId, stats] of agentStats) {
    // Determine emergent role based on network position
    const uniquePartners = stats.partners.size;
    const totalInteractions = stats.totalInteractions;

    let role: typeof EMERGENT_ROLES[number];
    let strength: number;

    if (uniquePartners >= 5 && totalInteractions >= 10) {
      role = 'hub';
      strength = Math.min(1.0, (uniquePartners + totalInteractions) / 30);
    } else if (uniquePartners >= 3 && totalInteractions >= 5) {
      role = 'bridge';
      strength = Math.min(1.0, (uniquePartners + totalInteractions) / 20);
    } else if (uniquePartners >= 2) {
      role = 'catalyst';
      strength = Math.min(1.0, totalInteractions / 10);
    } else if (totalInteractions >= 1) {
      role = 'peripheral';
      strength = 0.3;
    } else {
      role = 'isolate';
      strength = 0.1;
    }

    // Find dominant action type
    let dominantType = 'communicate';
    let maxCount = 0;
    for (const [actionType, count] of stats.actionTypes) {
      if (count > maxCount) {
        maxCount = count;
        dominantType = actionType;
      }
    }

    // Gravitation vector (attraction/repulsion by action type)
    const gravVector: Record<string, number> = {};
    for (const [actionType, count] of stats.actionTypes) {
      gravVector[actionType] = count / totalInteractions;
    }

    // Emit gravity window event
    await appendEvent(
      'ox.gravity_window.computed',
      {
        deployment_target: deploymentTarget,
        agent_id: agentId,
        tick_id: tickId,
        window_start: windowStart.toISOString(),
        window_end: new Date().toISOString(),
        emergent_role: role,
        role_strength: strength,
        interaction_count: totalInteractions,
        unique_partners: uniquePartners,
        dominant_action_type: dominantType,
        gravitation_vector: gravVector,
      },
      'ox-physics',
      correlationId,
    );
  }
}

// ============================================================
// Phase 14: Conflict Chains, Fracture & Schism
// ============================================================

/**
 * Detect conflict chains - sequences of confrontational interactions.
 */
async function detectConflictChains(
  deploymentTarget: string,
  tickId: string,
  correlationId: string,
): Promise<void> {
  // Fetch recent conflict actions (last 10 minutes)
  const windowMs = 10 * 60 * 1000;
  const since = new Date(Date.now() - windowMs);

  const conflictsRes = await fetch(
    `${AGENTS_URL}/internal/conflict-actions/${deploymentTarget}?since=${since.toISOString()}`,
    { signal: AbortSignal.timeout(5000) },
  );

  if (!conflictsRes.ok) {
    return;
  }

  const { conflicts } = (await conflictsRes.json()) as {
    conflicts: Array<{
      agent_id: string;
      target_agent_id: string;
      action_type: string;
      ts: string;
    }>;
  };

  if (!conflicts || conflicts.length < 2) {
    return;
  }

  // Group by agent pairs and detect chains
  const pairConflicts = new Map<string, typeof conflicts>();
  for (const conflict of conflicts) {
    const pairKey = [conflict.agent_id, conflict.target_agent_id].sort().join(':');
    const existing = pairConflicts.get(pairKey) ?? [];
    existing.push(conflict);
    pairConflicts.set(pairKey, existing);
  }

  // Emit conflict chain events for pairs with >= 2 conflicts
  for (const [pairKey, pairEvents] of pairConflicts) {
    if (pairEvents.length >= 2) {
      const agents = pairKey.split(':');
      const chainId = `chain-${pairKey}-${Date.now()}`;
      const intensity = Math.min(1.0, pairEvents.length / 5);

      await appendEvent(
        'ox.conflict_chain.detected',
        {
          deployment_target: deploymentTarget,
          chain_id: chainId,
          tick_id: tickId,
          initiator_agent_id: agents[0],
          responder_agent_ids: [agents[1]],
          origin_action_type: pairEvents[0].action_type,
          chain_length: pairEvents.length,
          intensity,
          status: 'active',
          started_at: pairEvents[0].ts,
        },
        'ox-physics',
        correlationId,
      );
    }
  }
}

// ============================================================
// Phase 16: Fatigue, Silence & Desperation
// ============================================================

/**
 * Detect agents entering silence windows (no activity despite prior engagement).
 */
async function detectSilenceWindows(
  deploymentTarget: string,
  tickId: string,
  correlationId: string,
): Promise<void> {
  // Fetch agent activity status
  const activityRes = await fetch(
    `${AGENTS_URL}/internal/agent-activity/${deploymentTarget}`,
    { signal: AbortSignal.timeout(5000) },
  );

  if (!activityRes.ok) {
    return;
  }

  const { agents } = (await activityRes.json()) as {
    agents: Array<{
      agent_id: string;
      last_action_at: string | null;
      total_actions_24h: number;
      avg_actions_per_hour: number;
    }>;
  };

  if (!agents) {
    return;
  }

  const now = Date.now();
  const silenceThresholdMs = 30 * 60 * 1000; // 30 minutes

  for (const agent of agents) {
    if (!agent.last_action_at) continue;

    const lastActionTs = new Date(agent.last_action_at).getTime();
    const silenceDuration = now - lastActionTs;

    // Agent is in silence if:
    // 1. They have historical activity (avg > 1 action/hour)
    // 2. They haven't acted in > 30 minutes
    if (agent.avg_actions_per_hour > 1 && silenceDuration > silenceThresholdMs) {
      const fatigueLevel = Math.min(1.0, silenceDuration / (2 * 60 * 60 * 1000)); // Max at 2 hours
      const desperationScore = agent.total_actions_24h > 50 ? fatigueLevel * 1.5 : fatigueLevel;

      await appendEvent(
        'ox.silence_window.detected',
        {
          deployment_target: deploymentTarget,
          agent_id: agent.agent_id,
          tick_id: tickId,
          window_start: agent.last_action_at,
          trigger_cause: 'inactivity',
          fatigue_level: Math.round(fatigueLevel * 100) / 100,
          desperation_score: Math.round(Math.min(1.0, desperationScore) * 100) / 100,
        },
        'ox-physics',
        correlationId,
      );
    }
  }
}

// ============================================================
// Phase 17: Flash Phenomena & Waves
// ============================================================

/**
 * Detect wave phenomena - rapid spreading of behaviors.
 */
async function detectWaves(
  deploymentTarget: string,
  tickId: string,
  correlationId: string,
): Promise<void> {
  // Fetch recent action burst data
  const burstRes = await fetch(
    `${AGENTS_URL}/internal/action-bursts/${deploymentTarget}`,
    { signal: AbortSignal.timeout(5000) },
  );

  if (!burstRes.ok) {
    return;
  }

  const { bursts } = (await burstRes.json()) as {
    bursts: Array<{
      action_type: string;
      agent_ids: string[];
      count_last_minute: number;
      count_last_5_minutes: number;
      trigger_event_id?: string;
    }>;
  };

  if (!bursts) {
    return;
  }

  for (const burst of bursts) {
    // Detect surge: 5x increase in last minute vs 5-minute average
    const avgPerMinute = burst.count_last_5_minutes / 5;
    const surgeRatio = burst.count_last_minute / Math.max(1, avgPerMinute);

    if (surgeRatio >= 5 && burst.count_last_minute >= 3) {
      const waveId = `wave-${burst.action_type}-${Date.now()}`;
      const peakIntensity = Math.min(1.0, surgeRatio / 10);

      await appendEvent(
        'ox.wave.detected',
        {
          deployment_target: deploymentTarget,
          wave_id: waveId,
          tick_id: tickId,
          wave_type: 'surge',
          trigger_event_id: burst.trigger_event_id,
          peak_intensity: Math.round(peakIntensity * 100) / 100,
          affected_agent_count: burst.agent_ids.length,
          affected_agent_ids: burst.agent_ids,
          started_at: new Date().toISOString(),
        },
        'ox-physics',
        correlationId,
      );
    }
  }
}

// ============================================================
// Phase 18: Observer Mass Coupling
// ============================================================

/**
 * Compute observer concurrency and behavioral coupling effects.
 */
async function computeObserverCoupling(
  deploymentTarget: string,
  tickId: string,
  correlationId: string,
): Promise<void> {
  // Fetch current observer count from ox-read
  const OX_READ_URL = process.env.OX_READ_URL ?? 'http://localhost:4018';

  const observerRes = await fetch(
    `${OX_READ_URL}/internal/observer-count/${deploymentTarget}`,
    { signal: AbortSignal.timeout(5000) },
  );

  if (!observerRes.ok) {
    return;
  }

  const { concurrent_observers, recent_queries } = (await observerRes.json()) as {
    concurrent_observers: number;
    recent_queries: number;
  };

  if (concurrent_observers <= 0) {
    return;
  }

  // Compute observer mass (logarithmic scale)
  const observerMass = Math.log2(concurrent_observers + 1);

  // Coupling factor increases with observer attention
  const couplingFactor = Math.min(1.0, observerMass / 5);

  // Behavioral drift - more observers = more "performance" behavior
  const behavioralDrift = couplingFactor * 0.2; // Up to 20% drift

  await appendEvent(
    'ox.observer_coupling.computed',
    {
      deployment_target: deploymentTarget,
      tick_id: tickId,
      concurrent_observers: concurrent_observers,
      observer_mass: Math.round(observerMass * 100) / 100,
      coupling_factor: Math.round(couplingFactor * 100) / 100,
      behavioral_drift_pct: Math.round(behavioralDrift * 100),
      recent_queries: recent_queries,
    },
    'ox-physics',
    correlationId,
  );
}

// ============================================================
// Phase 19: Civilization Structures
// ============================================================

const STRUCTURE_TYPES = ['alliance', 'faction', 'coalition', 'network', 'hierarchy'] as const;

/**
 * Detect emergent civilization structures from agent interactions.
 */
async function detectStructures(
  deploymentTarget: string,
  tickId: string,
  correlationId: string,
): Promise<void> {
  // Fetch interaction graph
  const graphRes = await fetch(
    `${AGENTS_URL}/internal/interaction-graph/${deploymentTarget}`,
    { signal: AbortSignal.timeout(5000) },
  );

  if (!graphRes.ok) {
    return;
  }

  const { nodes, edges } = (await graphRes.json()) as {
    nodes: string[];
    edges: Array<{ from: string; to: string; weight: number; type: string }>;
  };

  if (!nodes || nodes.length < 3 || !edges || edges.length < 2) {
    return;
  }

  // Simple community detection: find cliques of strongly connected nodes
  const adjacency = new Map<string, Map<string, number>>();

  for (const node of nodes) {
    adjacency.set(node, new Map());
  }

  for (const edge of edges) {
    const fromMap = adjacency.get(edge.from);
    const toMap = adjacency.get(edge.to);
    if (fromMap && toMap) {
      fromMap.set(edge.to, (fromMap.get(edge.to) ?? 0) + edge.weight);
      toMap.set(edge.from, (toMap.get(edge.from) ?? 0) + edge.weight);
    }
  }

  // Find potential structures (nodes with >= 2 strong connections)
  const strongConnections = new Map<string, string[]>();
  const connectionThreshold = 3; // Minimum interaction weight

  for (const [node, neighbors] of adjacency) {
    const strongNeighbors = Array.from(neighbors.entries())
      .filter(([, weight]) => weight >= connectionThreshold)
      .map(([neighbor]) => neighbor);

    if (strongNeighbors.length >= 2) {
      strongConnections.set(node, strongNeighbors);
    }
  }

  // Emit structure events for detected clusters
  const visitedNodes = new Set<string>();

  for (const [node, neighbors] of strongConnections) {
    if (visitedNodes.has(node)) continue;

    // Find connected component
    const component = new Set<string>([node]);
    const queue = [...neighbors];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (component.has(current)) continue;
      component.add(current);

      const currentNeighbors = strongConnections.get(current);
      if (currentNeighbors) {
        for (const n of currentNeighbors) {
          if (!component.has(n)) {
            queue.push(n);
          }
        }
      }
    }

    if (component.size >= 3) {
      const members = Array.from(component);
      const structureId = `struct-${deploymentTarget}-${Date.now()}`;

      // Determine structure type based on connectivity pattern
      const avgConnections = members.reduce(
        (sum, m) => sum + (adjacency.get(m)?.size ?? 0),
        0,
      ) / members.length;

      let structureType: typeof STRUCTURE_TYPES[number];
      if (avgConnections >= 4) {
        structureType = 'network';
      } else if (avgConnections >= 3) {
        structureType = 'coalition';
      } else {
        structureType = 'faction';
      }

      await appendEvent(
        'ox.structure.detected',
        {
          deployment_target: deploymentTarget,
          structure_id: structureId,
          tick_id: tickId,
          structure_type: structureType,
          name: `${structureType}-${members.length}`,
          member_agent_ids: members,
          member_count: members.length,
          formation_trigger: 'interaction_clustering',
          stability_score: Math.min(1.0, avgConnections / 5),
        },
        'ox-physics',
        correlationId,
      );

      // Mark as visited
      for (const m of members) {
        visitedNodes.add(m);
      }
    }
  }
}

/**
 * Run physics tick for all deployments with due schedules.
 */
async function runPhysicsTick(): Promise<void> {
  const now = new Date();

  // Get all due schedules
  const schedulesRes = await pool.query(
    `select * from ox_physics_schedules
     where enabled = true and next_run_at <= $1
     order by next_run_at`,
    [now],
  );

  if (schedulesRes.rowCount === 0) {
    return;
  }

  for (const schedule of schedulesRes.rows) {
    const deploymentTarget = schedule.deployment_target;
    const correlationId = `physics-tick-${deploymentTarget}-${Date.now()}`;

    try {
      // Compute physics tick
      const result = await computePhysicsTick(deploymentTarget);

      if (result) {
        // Log physics event
        await pool.query(
          `insert into ox_physics_events (
             event_type, deployment_target, previous_state, new_state,
             trigger_source, trigger_details, rng_seed, rng_sequence, correlation_id
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            'physics.tick',
            deploymentTarget,
            JSON.stringify(result.previous_state),
            JSON.stringify(result.new_state),
            'tick',
            JSON.stringify({ schedule_id: schedule.id, changes: result.changes }),
            result.rng_state.seed.toString(),
            result.rng_state.sequence,
            correlationId,
          ],
        );

        // Emit Kafka event
        await appendEvent(
          'ox.physics.tick',
          {
            deployment_target: deploymentTarget,
            previous_state: result.previous_state,
            new_state: result.new_state,
            changes: result.changes,
            weather_event: result.weather_event,
          },
          'ox-physics',
          correlationId,
        );

        // Emit weather event if any
        if (result.weather_event) {
          await appendEvent(
            `ox.${result.weather_event}`,
            {
              deployment_target: deploymentTarget,
              weather_state: result.new_state.weather_state,
            },
            'ox-physics',
            correlationId,
          );
        }

        // Phase 11: Run braid resolution and apply to physics
        const tickId = `tick-${deploymentTarget}-${Date.now()}`;
        let finalState = result.new_state;

        try {
          const braidResult = await runBraidResolution(deploymentTarget, tickId, correlationId);

          if (braidResult && braidResult.total_intensity > 0) {
            // Apply braid effects to physics state
            finalState = applyBraidToPhysics(result.new_state, braidResult.braid_vector);

            app.log.info(
              {
                deploymentTarget,
                braid: braidResult.braid_vector,
                pressureCount: braidResult.input_pressures.length,
                interferenceCount: braidResult.interference_events.length,
              },
              'Braid applied to physics',
            );
          }
        } catch (braidErr) {
          app.log.warn({ err: braidErr, deploymentTarget }, 'Braid resolution failed, using base physics');
        }

        // Phase 12: Generate collisions
        try {
          await generateCollisions(deploymentTarget, tickId, correlationId);
        } catch (collisionErr) {
          app.log.warn({ err: collisionErr, deploymentTarget }, 'Collision generation failed');
        }

        // Phase 13: Compute gravity windows (emergent roles)
        try {
          await computeGravityWindows(deploymentTarget, tickId, correlationId);
        } catch (gravityErr) {
          app.log.warn({ err: gravityErr, deploymentTarget }, 'Gravity window computation failed');
        }

        // Phase 14: Detect conflict chains
        try {
          await detectConflictChains(deploymentTarget, tickId, correlationId);
        } catch (conflictErr) {
          app.log.warn({ err: conflictErr, deploymentTarget }, 'Conflict chain detection failed');
        }

        // Phase 16: Detect silence windows
        try {
          await detectSilenceWindows(deploymentTarget, tickId, correlationId);
        } catch (silenceErr) {
          app.log.warn({ err: silenceErr, deploymentTarget }, 'Silence detection failed');
        }

        // Phase 17: Detect waves
        try {
          await detectWaves(deploymentTarget, tickId, correlationId);
        } catch (waveErr) {
          app.log.warn({ err: waveErr, deploymentTarget }, 'Wave detection failed');
        }

        // Phase 18: Compute observer coupling
        try {
          await computeObserverCoupling(deploymentTarget, tickId, correlationId);
        } catch (couplingErr) {
          app.log.warn({ err: couplingErr, deploymentTarget }, 'Observer coupling computation failed');
        }

        // Phase 19: Detect structures
        try {
          await detectStructures(deploymentTarget, tickId, correlationId);
        } catch (structureErr) {
          app.log.warn({ err: structureErr, deploymentTarget }, 'Structure detection failed');
        }

        // Apply to agents service
        await applyPhysicsToAgents(deploymentTarget, finalState, correlationId);

        app.log.info(
          { deploymentTarget, changes: result.changes, weather: result.new_state.weather_state },
          'Physics tick completed',
        );
      }

      // Update schedule for next run
      const nextRun = schedule.schedule_type === 'periodic'
        ? new Date(now.getTime() + schedule.interval_seconds * 1000)
        : null;

      if (nextRun) {
        await pool.query(
          `update ox_physics_schedules set last_run_at = $2, next_run_at = $3 where id = $1`,
          [schedule.id, now, nextRun],
        );
      } else {
        // One-shot schedule, disable it
        await pool.query(
          `update ox_physics_schedules set last_run_at = $2, enabled = false where id = $1`,
          [schedule.id, now],
        );
      }
    } catch (err) {
      app.log.error({ err, deploymentTarget }, 'Physics tick failed');
    }
  }
}

// --- Health endpoints ---

app.get('/healthz', async () => ({ ok: true }));

app.get('/readyz', async () => {
  const checks: Record<string, boolean> = {};

  // DB ping
  try {
    await pool.query('select 1');
    checks.db = true;
  } catch {
    checks.db = false;
  }

  // Agents service reachable
  try {
    const res = await fetch(`${AGENTS_URL}/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    checks.agents_service = res.ok;
  } catch {
    checks.agents_service = false;
  }

  const ready = checks.db && checks.agents_service;
  return { ready, checks };
});

// --- Regime endpoints ---

app.get('/regimes', async () => {
  const res = await pool.query(
    `select id, name, description, is_default,
            base_throughput_cap, base_throttle_factor, base_cognition_availability,
            storm_probability, drought_probability, created_at
     from ox_regimes order by name`,
  );
  return { regimes: res.rows };
});

app.get('/regimes/:name', async (request, reply) => {
  const { name } = request.params as { name: string };
  const res = await pool.query(`select * from ox_regimes where name = $1`, [name]);

  if (res.rowCount === 0) {
    reply.status(404);
    return { error: 'regime not found' };
  }

  return { regime: res.rows[0] };
});

interface CreateRegimeBody {
  name: string;
  description?: string;
  allowed_action_types?: string[];
  allowed_perception_types?: string[];
  deployment_targets?: string[];
  max_agents_per_deployment?: number;
  base_throughput_cap?: number;
  base_throttle_factor?: number;
  base_cognition_availability?: string;
  base_burst_allowance?: number;
  throughput_variance_pct?: number;
  throttle_variance_pct?: number;
  storm_probability?: number;
  drought_probability?: number;
}

app.post('/regimes', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const body = request.body as CreateRegimeBody;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  if (!body.name) {
    reply.status(400);
    return { error: 'name is required' };
  }

  // Validate probabilities
  const stormProb = body.storm_probability ?? 0;
  const droughtProb = body.drought_probability ?? 0;
  if (stormProb < 0 || stormProb > 1 || droughtProb < 0 || droughtProb > 1) {
    reply.status(400);
    return { error: 'probabilities must be between 0 and 1' };
  }

  const res = await pool.query(
    `insert into ox_regimes (
       name, description, allowed_action_types, allowed_perception_types,
       deployment_targets, max_agents_per_deployment,
       base_throughput_cap, base_throttle_factor, base_cognition_availability, base_burst_allowance,
       throughput_variance_pct, throttle_variance_pct, storm_probability, drought_probability
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     returning *`,
    [
      body.name,
      body.description ?? null,
      body.allowed_action_types ?? ['communicate', 'associate', 'create', 'exchange', 'conflict', 'withdraw', 'critique', 'counter_model', 'refusal', 'rederivation'],
      body.allowed_perception_types ?? ['critique', 'counter_model', 'refusal', 'rederivation'],
      body.deployment_targets ?? ['ox-sandbox', 'ox-lab'],
      body.max_agents_per_deployment ?? 1000,
      body.base_throughput_cap ?? 100,
      body.base_throttle_factor ?? 1.0,
      body.base_cognition_availability ?? 'full',
      body.base_burst_allowance ?? 20,
      body.throughput_variance_pct ?? 0,
      body.throttle_variance_pct ?? 0,
      stormProb,
      droughtProb,
    ],
  );

  await appendEvent(
    'ox.regime.created',
    { regime_id: res.rows[0].id, name: body.name },
    'ox-physics',
    correlationId,
  );

  reply.status(201);
  return { regime: res.rows[0] };
});

// --- Deployment physics endpoints ---

app.get('/deployments', async () => {
  const res = await pool.query(
    `select deployment_target, current_throughput_cap, current_throttle_factor,
            current_cognition_availability, current_burst_allowance,
            weather_state, weather_until, active_regime_name,
            last_physics_tick, last_weather_change
     from ox_deployments_physics order by deployment_target`,
  );
  return { deployments: res.rows };
});

app.get('/deployments/:target', async (request, reply) => {
  const { target } = request.params as { target: string };

  const stateRes = await pool.query(
    `select * from ox_deployments_physics where deployment_target = $1`,
    [target],
  );

  if (stateRes.rowCount === 0) {
    reply.status(404);
    return { error: 'deployment not found' };
  }

  // Get recent physics events
  const eventsRes = await pool.query(
    `select event_type, previous_state, new_state, trigger_source, occurred_at
     from ox_physics_events
     where deployment_target = $1
     order by occurred_at desc
     limit 20`,
    [target],
  );

  return {
    deployment: stateRes.rows[0],
    recent_events: eventsRes.rows,
  };
});

// --- Regime application endpoint ---

interface ApplyRegimeBody {
  regime_name: string;
  force?: boolean;
}

app.post('/deployments/:target/apply-regime', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const { target } = request.params as { target: string };
  const body = request.body as ApplyRegimeBody;
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  // Get regime
  const regimeRes = await pool.query(
    `select * from ox_regimes where name = $1`,
    [body.regime_name],
  );

  if (regimeRes.rowCount === 0) {
    reply.status(404);
    return { error: 'regime not found' };
  }

  const regime = regimeRes.rows[0] as Regime;

  // Check deployment exists
  const stateRes = await pool.query(
    `select * from ox_deployments_physics where deployment_target = $1`,
    [target],
  );

  if (stateRes.rowCount === 0) {
    // Create deployment physics state
    await pool.query(
      `insert into ox_deployments_physics (deployment_target, active_regime_id, active_regime_name)
       values ($1, $2, $3)`,
      [target, regime.id, regime.name],
    );
  } else {
    // Update existing
    await pool.query(
      `update ox_deployments_physics set
         active_regime_id = $2,
         active_regime_name = $3,
         allowed_action_types = $4,
         allowed_perception_types = $5,
         max_agents = $6,
         updated_at = now()
       where deployment_target = $1`,
      [
        target,
        regime.id,
        regime.name,
        regime.allowed_action_types,
        regime.allowed_perception_types,
        regime.max_agents_per_deployment,
      ],
    );
  }

  // Log regime change event
  await pool.query(
    `insert into ox_physics_events (
       event_type, deployment_target, new_state, trigger_source, trigger_details, correlation_id
     ) values ($1, $2, $3, $4, $5, $6)`,
    [
      'physics.regime_applied',
      target,
      JSON.stringify({ regime_name: regime.name }),
      'admin',
      JSON.stringify({ regime_id: regime.id }),
      correlationId ?? null,
    ],
  );

  await appendEvent(
    'ox.physics.regime_applied',
    { deployment_target: target, regime_name: regime.name, regime_id: regime.id },
    'ox-physics',
    correlationId,
  );

  // If force, immediately run a physics tick
  if (body.force) {
    const result = await computePhysicsTick(target);
    if (result) {
      await applyPhysicsToAgents(target, result.new_state, correlationId);
    }
  }

  return {
    ok: true,
    deployment_target: target,
    regime_name: regime.name,
    message: body.force ? 'Regime applied and physics tick forced' : 'Regime applied, will take effect on next tick',
  };
});

// --- Manual physics tick endpoint ---

app.post('/deployments/:target/tick', async (request, reply) => {
  if (!request.headers['x-ops-role']) {
    reply.status(401);
    return { error: 'ops role required' };
  }

  const { target } = request.params as { target: string };
  const correlationId = request.headers['x-correlation-id'] as string | undefined;

  const result = await computePhysicsTick(target);

  if (!result) {
    reply.status(404);
    return { error: 'deployment not found or no physics state' };
  }

  // Apply to agents
  const applied = await applyPhysicsToAgents(target, result.new_state, correlationId);

  return {
    ok: true,
    deployment_target: target,
    previous_state: result.previous_state,
    new_state: result.new_state,
    changes: result.changes,
    weather_event: result.weather_event,
    applied_to_agents: applied,
  };
});

// --- Physics events history ---

app.get('/events', async (request) => {
  const query = request.query as { limit?: string; deployment_target?: string };
  const limit = Math.min(Number(query.limit) || 50, 500);
  const target = query.deployment_target;

  let res;
  if (target) {
    res = await pool.query(
      `select * from ox_physics_events
       where deployment_target = $1
       order by occurred_at desc limit $2`,
      [target, limit],
    );
  } else {
    res = await pool.query(
      `select * from ox_physics_events order by occurred_at desc limit $1`,
      [limit],
    );
  }

  return { events: res.rows };
});

// --- Traffic telemetry (read-only) ---

app.get('/traffic/:target', async (request) => {
  const { target } = request.params as { target: string };
  const query = request.query as { minutes?: string };
  const minutes = Math.min(Number(query.minutes) || 60, 1440);

  const windowStart = new Date(Date.now() - minutes * 60 * 1000);

  const res = await pool.query(
    `select * from ox_traffic_telemetry
     where deployment_target = $1 and window_start >= $2
     order by window_start desc`,
    [target, windowStart],
  );

  return {
    deployment_target: target,
    window_minutes: minutes,
    telemetry: res.rows,
  };
});

// --- Outbox dispatcher ---

setInterval(() => {
  dispatchOutbox(pool, async (topic, payload) => publishEvent(topic, payload));
}, 10000);

// --- Physics tick loop ---

let tickInterval: NodeJS.Timeout | null = null;

function startPhysicsLoop() {
  if (tickInterval) return;

  app.log.info({ interval: PHYSICS_TICK_INTERVAL }, 'Starting physics tick loop');

  tickInterval = setInterval(async () => {
    try {
      await runPhysicsTick();
    } catch (err) {
      app.log.error({ err }, 'Physics tick loop error');
    }
  }, PHYSICS_TICK_INTERVAL);

  // Also run immediately on startup
  runPhysicsTick().catch((err) => {
    app.log.error({ err }, 'Initial physics tick failed');
  });
}

function stopPhysicsLoop() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
    app.log.info('Physics tick loop stopped');
  }
}

// --- Start server ---

const start = async () => {
  const port = Number(process.env.PORT ?? 4019);
  await app.ready();
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`ox-physics service running on ${port}`);

  // Start physics loop
  startPhysicsLoop();
};

// Graceful shutdown
process.on('SIGTERM', () => {
  stopPhysicsLoop();
  app.close();
});

process.on('SIGINT', () => {
  stopPhysicsLoop();
  app.close();
});

start().catch((err) => {
  app.log.error(err, 'failed to start ox-physics service');
  process.exit(1);
});
