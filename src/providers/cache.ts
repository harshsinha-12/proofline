import { z } from "zod";
import { redisKey } from "@/lib/redis";
import { parseStored, withRedis } from "@/lib/store-utils";

export const CACHE_RETENTION_SECONDS = 604_800;

export async function readCache<T>(kind: string, hash: string, schema: z.ZodType<T>): Promise<T | null> {
  return withRedis(async (redis) => {
    const value = await redis.get(redisKey("cache", kind, hash));
    return value ? parseStored(value, schema.parse) : null;
  });
}

export async function writeCache(kind: string, hash: string, value: unknown): Promise<void> {
  await withRedis(async (redis) => { await redis.set(redisKey("cache", kind, hash), JSON.stringify(value), "EX", CACHE_RETENTION_SECONDS); });
}
