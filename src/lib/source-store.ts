import { redisKey } from "@/lib/redis";
import { AppError } from "@/lib/errors";
import { hashJson } from "@/lib/hashing";
import { getDemoFixture } from "@/lib/demo-fixture";
import { parseStored, withRedis } from "@/lib/store-utils";
import { commitRunCommands, loadRun, requirePersistedRun, runRetentionSeconds, runWriteCommands, withRunLock } from "@/lib/run-store";
import { sourceSchema, type Source } from "@/schemas/source";
import { invalidateDiagnosticApproval } from "@/lib/diagnostic-audit";

export async function saveSource(runId: string, source: Source, lockToken?: string): Promise<Source> {
  const parsed = sourceSchema.parse(source);
  return withRunLock(runId, async (token) => {
    const run = await requirePersistedRun(runId);
    const previous = await withRedis(async (redis) => {
      const value = await redis.get(redisKey("run", runId, "source", parsed.id));
      return value ? parseStored(value, sourceSchema.parse) : null;
    });
    if (previous && hashJson(previous) === hashJson(parsed)) return previous;
    const updated = { ...invalidateDiagnosticApproval(run), updatedAt: new Date().toISOString() };
    const base = redisKey("run", runId);
    const ttl = runRetentionSeconds(updated);
    await commitRunCommands(runId, token, [["SET", `${base}:source:${parsed.id}`, JSON.stringify(parsed), "EX", ttl],
      ["SADD", `${base}:sources`, parsed.id], ["EXPIRE", `${base}:sources`, ttl], ["DEL", `${base}:snapshot`], ...await runWriteCommands(updated)]);
    return parsed;
  }, lockToken);
}

export async function getSource(runId: string, sourceId: string): Promise<Source | null> {
  const sources = await getSources(runId);
  return sources.find((source) => source.id === sourceId) ?? null;
}

export async function getSources(runId: string): Promise<Source[]> {
  const loaded = await loadRun(runId);
  if (!loaded) return [];
  if (loaded.fixtureMode) return getDemoFixture()!.sources;
  return withRedis(async (redis) => {
    const base = redisKey("run", runId);
    const ids = (await redis.smembers(`${base}:sources`)).sort();
    if (!ids.length) return [];
    const values = await redis.mget(...ids.map((id) => `${base}:source:${id}`));
    if (values.some((value) => value === null)) throw new AppError("validation_failed", "The source ledger contains a missing indexed source.", 500);
    return values.filter((value): value is string => value !== null).map((value) => parseStored(value, sourceSchema.parse));
  });
}
