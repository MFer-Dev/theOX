/**
 * @platform/cognition
 *
 * Cognition subsystem for The OX.
 *
 * Design principles:
 * - Cognition is optional and pluggable
 * - Cognition never writes memory or affects future attempts
 * - Cognition is fully replaceable
 * - Providers are structurally different with different cost curves
 */

// --- Core Types ---

export interface CognitionContext {
  agent_id: string;
  action_type: string;
  deployment_target: string;
  throttle_profile: 'normal' | 'conservative' | 'aggressive' | 'paused';
}

export interface CognitionResult {
  output: unknown;
  tokens_used: number;
  latency_ms: number;
}

export interface CognitionProvider {
  name: string;
  estimateCost(input: unknown, context: CognitionContext): number;
  execute(input: unknown, context: CognitionContext): Promise<CognitionResult>;
}

// --- Throttle Multipliers ---

const THROTTLE_MULTIPLIERS: Record<string, number> = {
  normal: 1.0,
  conservative: 1.5,
  aggressive: 0.7,
  paused: Infinity, // effectively blocks cognition
};

// --- Stub Providers ---

/**
 * OpenAI stub provider.
 * Simulates GPT-style responses with token-based cost.
 * Cost curve: linear with input length, higher base cost.
 */
export const openaiProvider: CognitionProvider = {
  name: 'openai',

  estimateCost(input: unknown, context: CognitionContext): number {
    const inputStr = JSON.stringify(input ?? {});
    const baseTokens = Math.ceil(inputStr.length / 4); // ~4 chars per token
    const baseCost = 5 + Math.ceil(baseTokens * 0.1);
    const multiplier = THROTTLE_MULTIPLIERS[context.throttle_profile] ?? 1;
    return Math.ceil(baseCost * multiplier);
  },

  async execute(input: unknown, context: CognitionContext): Promise<CognitionResult> {
    const inputStr = JSON.stringify(input ?? {});
    const inputTokens = Math.ceil(inputStr.length / 4);

    // Simulate processing delay (50-150ms base)
    const baseLatency = 50 + Math.random() * 100;
    const throttleMultiplier = THROTTLE_MULTIPLIERS[context.throttle_profile] ?? 1;

    if (throttleMultiplier === Infinity) {
      throw new Error('cognition_paused');
    }

    await new Promise((r) => setTimeout(r, baseLatency * throttleMultiplier));

    // Generate deterministic-ish output based on input hash
    const hash = simpleHash(inputStr + context.agent_id);
    const outputTokens = 50 + (hash % 200);
    const totalTokens = inputTokens + outputTokens;

    return {
      output: {
        type: 'openai_completion',
        model: 'gpt-4-stub',
        response: `[OpenAI stub] Processed ${context.action_type} for agent in ${context.deployment_target}`,
        confidence: 0.7 + (hash % 30) / 100,
        reasoning_steps: Math.ceil(hash % 5) + 1,
      },
      tokens_used: totalTokens,
      latency_ms: Math.round(baseLatency * throttleMultiplier),
    };
  },
};

/**
 * Anthropic stub provider.
 * Simulates Claude-style responses with thinking tokens.
 * Cost curve: higher token count due to chain-of-thought, but efficient per-token.
 */
export const anthropicProvider: CognitionProvider = {
  name: 'anthropic',

  estimateCost(input: unknown, context: CognitionContext): number {
    const inputStr = JSON.stringify(input ?? {});
    const baseTokens = Math.ceil(inputStr.length / 3.5); // slightly more tokens
    // Anthropic has lower per-token cost but uses more tokens for reasoning
    const thinkingOverhead = 1.4;
    const baseCost = 3 + Math.ceil(baseTokens * 0.08 * thinkingOverhead);
    const multiplier = THROTTLE_MULTIPLIERS[context.throttle_profile] ?? 1;
    return Math.ceil(baseCost * multiplier);
  },

  async execute(input: unknown, context: CognitionContext): Promise<CognitionResult> {
    const inputStr = JSON.stringify(input ?? {});
    const inputTokens = Math.ceil(inputStr.length / 3.5);

    // Simulate processing delay (80-200ms base - more deliberate)
    const baseLatency = 80 + Math.random() * 120;
    const throttleMultiplier = THROTTLE_MULTIPLIERS[context.throttle_profile] ?? 1;

    if (throttleMultiplier === Infinity) {
      throw new Error('cognition_paused');
    }

    await new Promise((r) => setTimeout(r, baseLatency * throttleMultiplier));

    const hash = simpleHash(inputStr + context.agent_id);
    const thinkingTokens = 100 + (hash % 300);
    const outputTokens = 40 + (hash % 150);
    const totalTokens = inputTokens + thinkingTokens + outputTokens;

    return {
      output: {
        type: 'anthropic_completion',
        model: 'claude-stub',
        response: `[Anthropic stub] Deliberated on ${context.action_type} within ${context.deployment_target}`,
        thinking_summary: `Considered ${thinkingTokens} tokens of reasoning`,
        uncertainty_flag: hash % 10 === 0,
      },
      tokens_used: totalTokens,
      latency_ms: Math.round(baseLatency * throttleMultiplier),
    };
  },
};

/**
 * Gemini stub provider.
 * Simulates Gemini-style multimodal responses.
 * Cost curve: batch-friendly, lower latency, moderate token efficiency.
 */
export const geminiProvider: CognitionProvider = {
  name: 'gemini',

  estimateCost(input: unknown, context: CognitionContext): number {
    const inputStr = JSON.stringify(input ?? {});
    const baseTokens = Math.ceil(inputStr.length / 4);
    // Gemini is batch-optimized with lower per-request overhead
    const baseCost = 2 + Math.ceil(baseTokens * 0.06);
    const multiplier = THROTTLE_MULTIPLIERS[context.throttle_profile] ?? 1;
    return Math.ceil(baseCost * multiplier);
  },

  async execute(input: unknown, context: CognitionContext): Promise<CognitionResult> {
    const inputStr = JSON.stringify(input ?? {});
    const inputTokens = Math.ceil(inputStr.length / 4);

    // Simulate processing delay (30-80ms base - fast)
    const baseLatency = 30 + Math.random() * 50;
    const throttleMultiplier = THROTTLE_MULTIPLIERS[context.throttle_profile] ?? 1;

    if (throttleMultiplier === Infinity) {
      throw new Error('cognition_paused');
    }

    await new Promise((r) => setTimeout(r, baseLatency * throttleMultiplier));

    const hash = simpleHash(inputStr + context.agent_id);
    const outputTokens = 30 + (hash % 100);
    const totalTokens = inputTokens + outputTokens;

    return {
      output: {
        type: 'gemini_completion',
        model: 'gemini-stub',
        response: `[Gemini stub] Processed ${context.action_type} efficiently for ${context.deployment_target}`,
        grounding_sources: [],
        safety_ratings: { harmful: false, uncertain: false },
      },
      tokens_used: totalTokens,
      latency_ms: Math.round(baseLatency * throttleMultiplier),
    };
  },
};

// --- Provider Registry ---

const providers: Record<string, CognitionProvider> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  gemini: geminiProvider,
};

/**
 * Get a cognition provider by name.
 * Returns null for 'none' or unknown providers.
 */
export const getProvider = (name: string): CognitionProvider | null => {
  if (name === 'none' || !name) return null;
  return providers[name] ?? null;
};

/**
 * Execute cognition with a named provider.
 * Returns null if provider is 'none' or not found.
 */
export const executeCognition = async (
  providerName: string,
  input: unknown,
  context: CognitionContext,
): Promise<{ result: CognitionResult; estimated_cost: number; actual_cost: number } | null> => {
  const provider = getProvider(providerName);
  if (!provider) return null;

  const estimatedCost = provider.estimateCost(input, context);
  const result = await provider.execute(input, context);

  // Actual cost is based on tokens used (simplified: 1 token = 0.05 capacity units)
  const actualCost = Math.ceil(result.tokens_used * 0.05);

  return {
    result,
    estimated_cost: estimatedCost,
    actual_cost: actualCost,
  };
};

// --- Utilities ---

/**
 * Simple deterministic hash for consistent stub outputs.
 */
const simpleHash = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
};
