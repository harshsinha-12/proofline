import Redis from "ioredis";
import { getEnv } from "@/lib/env";

const globalForRedis = globalThis as unknown as {
  prooflineRedis?: Redis;
};

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1";
}

export function redisKey(...parts: string[]): string {
  const prefix = getEnv().REDIS_KEY_PREFIX.replace(/:+$/, "");
  return [prefix, ...parts].join(":");
}

export function getRedis(): Redis {
  if (globalForRedis.prooflineRedis) {
    return globalForRedis.prooflineRedis;
  }

  const env = getEnv();
  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    username: env.REDIS_USERNAME,
    password: env.REDIS_PASSWORD,
    tls: (env.REDIS_TLS ?? !isLocalHost(env.REDIS_HOST)) ? {} : undefined,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableReadyCheck: true,
    connectTimeout: 5_000,
    retryStrategy: (attempt) => attempt > 2 ? null : Math.min(attempt * 100, 500),
  });
  client.on("error", () => {
    // Store operations surface typed errors without logging credentials or provider payloads.
  });

  globalForRedis.prooflineRedis = client;
  return client;
}

export async function pingRedis(): Promise<string> {
  return getRedis().ping();
}
