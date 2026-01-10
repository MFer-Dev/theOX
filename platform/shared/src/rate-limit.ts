import { createClient } from 'redis';
import { ensureCorrelationId } from './index';

const redisUrl = process.env.REDIS_URL || `redis://:${process.env.REDIS_PASSWORD || ''}@${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;

let client: ReturnType<typeof createClient> | null = null;
const getRedis = async () => {
  if (!client) {
    client = createClient({ url: redisUrl });
    await client.connect();
  }
  return client;
};

export type RateLimitConfig = {
  key: string;
  limit: number;
  windowSec: number;
  cooldownSec?: number;
  cooldownThreshold?: number;
};

const cooldownKey = (key: string) => `rl:cooldown:${key}`;

export const checkRateLimit = async (key: string, limit: number, windowSec: number, cooldownSec?: number, cooldownThreshold?: number) => {
  const redis = await getRedis();
  const isCooling = await redis.exists(cooldownKey(key));
  if (isCooling) return { allowed: false, cooled: true };
  const now = Math.floor(Date.now() / 1000);
  const bucket = `${key}:${Math.floor(now / windowSec)}`;
  const count = await redis.incr(bucket);
  if (count === 1) {
    await redis.expire(bucket, windowSec);
  }
  if (count > limit) {
    if (cooldownSec && cooldownThreshold && count >= cooldownThreshold) {
      await redis.setEx(cooldownKey(key), cooldownSec, '1');
    }
    return { allowed: false, cooled: false };
  }
  return { allowed: true, cooled: false };
};

export const rateLimitMiddleware = (config: RateLimitConfig) => {
  return async (req: any, reply: any) => {
    const correlationId = ensureCorrelationId(req.headers['x-correlation-id']);
    const userKey = config.key;
    const result = await checkRateLimit(userKey, config.limit, config.windowSec, config.cooldownSec, config.cooldownThreshold);
    if (!result.allowed) {
      reply.status(429).send({
        error: 'rate_limited',
        type: 'about:blank',
        title: 'Rate limit exceeded',
        status: 429,
        detail: result.cooled ? 'Cooldown applied' : 'Too many requests',
        correlationId,
      });
      return reply;
    }
  };
};

