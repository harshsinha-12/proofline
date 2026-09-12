import { AppError, redactSecrets } from "@/lib/errors";
import { getRedis } from "@/lib/redis";

export async function withRedis<T>(operation: (redis: ReturnType<typeof getRedis>) => Promise<T>): Promise<T> {
  try {
    return await operation(getRedis());
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("redis_unavailable", "The evidence ledger is unavailable. Retry when Redis is reachable.", 503, { cause: error });
  }
}

export function parseStored<T>(value: string, parse: (value: unknown) => T): T {
  try {
    return parse(JSON.parse(value));
  } catch {
    throw new AppError("validation_failed", "Stored evidence does not match its schema.", 500);
  }
}

const EVENT_DATA_KEYS = new Set(["query", "purpose", "latencyMs", "cacheHit", "inputTokens", "outputTokens", "estimatedCost", "sourceId", "claimId", "attempt", "issues", "previousStage", "stage", "count", "fixtureMode"]);

export function sanitizeEventData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  return Object.fromEntries(Object.entries(data).filter(([key]) => EVENT_DATA_KEYS.has(key)).map(([key, value]) =>
    [key, typeof value === "string" ? redactSecrets(value) : Array.isArray(value) ? value.filter((item) => typeof item === "string").map((item) => redactSecrets(item)) : typeof value === "number" || typeof value === "boolean" ? value : null],
  ));
}
