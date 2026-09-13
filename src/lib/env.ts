import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  value === "" || value === undefined ? undefined : value;

export const envSchema = z.object({
  REDIS_USERNAME: z.string().min(1),
  REDIS_PASSWORD: z.string().min(1),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive(),
  REDIS_TLS: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).transform((value) => value === "true").optional()),
  REDIS_KEY_PREFIX: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default("proofline:dev"),
  ),
  APP_URL: z.preprocess(
    emptyToUndefined,
    z.url().default("http://localhost:3000"),
  ),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SEARCH_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SEARCH_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(["openai", "tavily", "exa", "brave"]).default("openai"),
  ),
  MAX_SOURCES_PER_RUN: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(18),
  ),
  MAX_CLAIMS_PER_RUN: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(30),
  ),
  MAX_CONCURRENT_FETCHES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(3),
  ),
  RUN_RETENTION_SECONDS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(2_592_000),
  ),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, unknown>): Env {
  return envSchema.parse(source);
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (typeof window !== "undefined") {
    throw new Error("Environment variables are server-only.");
  }

  if (!cached) {
    cached = parseEnv(process.env as Record<string, unknown>);
  }

  return cached;
}

export function resetEnvCache() {
  cached = undefined;
}
