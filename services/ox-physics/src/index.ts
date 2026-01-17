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

        // Apply to agents service
        await applyPhysicsToAgents(deploymentTarget, result.new_state, correlationId);

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
