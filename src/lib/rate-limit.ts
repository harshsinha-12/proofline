import { redisKey } from "@/lib/redis";
import { withRedis } from "@/lib/store-utils";
import { AppError } from "@/lib/errors";

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
  const count = await withRedis(async (redis) => Number(await redis.eval(`
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return count`, 1, key, RATE_LIMIT_WINDOW_SECONDS)));

  return {
    allowed: count <= limit,
    limit,
    count,
    remaining: Math.max(0, limit - count),
    window,
  };
}

export async function requireRateLimit(provider: string): Promise<void> {
  if (!(await consumeRateLimit(provider)).allowed) throw new AppError("rate_limited", "Provider budget reached. Resume after the current rate-limit window.", 429);
}
