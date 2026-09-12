import { getRedis, redisKey } from "@/lib/redis";

export const RATE_LIMIT_WINDOW_SECONDS = 60;

const DEFAULT_LIMITS: Record<string, number> = {
  openai: 60,
  search: 30,
  fetch: 40,
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  count: number;
  remaining: number;
  window: number;
};

export async function consumeRateLimit(
  provider: string,
  limit = DEFAULT_LIMITS[provider] ?? 30,
): Promise<RateLimitResult> {
  const window = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SECONDS);
  const key = redisKey("rate", provider, String(window));
  const redis = getRedis();
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
  }

  return {
    allowed: count <= limit,
    limit,
    count,
    remaining: Math.max(0, limit - count),
    window,
  };
}
