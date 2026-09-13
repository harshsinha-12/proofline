import { randomUUID } from "node:crypto";
import { getEnv } from "@/lib/env";
import { AppError, redactSecrets } from "@/lib/errors";
import { createRunId } from "@/lib/ids";
import { hashJson } from "@/lib/hashing";
import { redisKey } from "@/lib/redis";
import { parseStored, sanitizeEventData, withRedis } from "@/lib/store-utils";
import { getDemoFixture, DEMO_RUN_ID } from "@/lib/demo-fixture";
import { normalizeUrl, isLinkedInProfileUrl } from "@/lib/urls";
import { researchRunSchema, executionEventSchema, type ResearchRun, type ExecutionEvent } from "@/schemas/run";

export const RUN_LOCK_SECONDS = 90;
export const MAX_RUN_EVENTS = 500;
export const IN_PROGRESS_RETENTION_SECONDS = 604_800;
export type RedisCommand = (string | number)[];

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

// Fence every write with the lock token, so expired workers cannot overwrite a successor.
const COMMIT_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local commands = cjson.decode(ARGV[2])
for _, command in ipairs(commands) do redis.call(unpack(command)) end
return 1`;

export function runRetentionSeconds(run: ResearchRun): number {
  return run.stage === "completed" || run.stage === "approved" ? getEnv().RUN_RETENTION_SECONDS : IN_PROGRESS_RETENTION_SECONDS;
}

export async function acquireRunLock(runId: string): Promise<string> {
  const token = randomUUID();
  return withRedis(async (redis) => {
    const acquired = await redis.set(redisKey("run", runId, "lock"), token, "EX", RUN_LOCK_SECONDS, "NX");
    if (!acquired) throw new AppError("lock_held", "This run is already being advanced or edited. Retry shortly.", 409);
    return token;
  });
}

export async function releaseRunLock(runId: string, token: string): Promise<boolean> {
  return withRedis(async (redis) => (await redis.eval(RELEASE_LOCK_SCRIPT, 1, redisKey("run", runId, "lock"), token)) === 1);
}

export async function getPersistedRun(runId: string): Promise<ResearchRun | null> {
  return withRedis(async (redis) => {
    const value = await redis.get(redisKey("run", runId));
    return value ? parseStored(value, researchRunSchema.parse) : null;
  });
}

export async function loadRun(runId: string): Promise<{ run: ResearchRun; fixtureMode: boolean } | null> {
  const run = await getPersistedRun(runId);
  if (run) return { run, fixtureMode: false };
  const demo = runId === DEMO_RUN_ID ? getDemoFixture() : null;
  return demo ? { run: demo.run, fixtureMode: true } : null;
}

export async function getRun(runId: string): Promise<ResearchRun | null> {
  return (await loadRun(runId))?.run ?? null;
}

export async function requirePersistedRun(runId: string): Promise<ResearchRun> {
  const run = await getPersistedRun(runId);
  if (!run) {
    if (runId === DEMO_RUN_ID && getDemoFixture()) throw new AppError("read_only", "The demo fixture is read-only.", 409);
    throw new AppError("not_found", "Research run not found.", 404);
  }
  return run;
}

export async function commitRunCommands(runId: string, token: string, commands: RedisCommand[]): Promise<void> {
  await withRedis(async (redis) => {
    const committed = await redis.eval(COMMIT_SCRIPT, 1, redisKey("run", runId, "lock"), token, JSON.stringify(commands));
    if (committed !== 1) throw new AppError("lock_held", "The run lock expired. Reload the checkpoint and retry.", 409);
  });
}

/** Pass an existing token when called inside a bounded pipeline stage. */
export async function withRunLock<T>(runId: string, operation: (token: string) => Promise<T>, existingToken?: string): Promise<T> {
  const token = existingToken ?? await acquireRunLock(runId);
  try {
    return await operation(token);
  } finally {
    if (!existingToken) await releaseRunLock(runId, token);
  }
}

export async function runWriteCommands(run: ResearchRun): Promise<RedisCommand[]> {
  const parsed = researchRunSchema.parse(run);
  const ttl = runRetentionSeconds(parsed);
  const base = redisKey("run", run.id);
  return withRedis(async (redis) => {
    const [sources, claims] = await Promise.all([redis.smembers(`${base}:sources`), redis.smembers(`${base}:claims`)]);
    const keys = [`${base}:sources`, `${base}:claims`, `${base}:events`, `${base}:snapshot`,
      ...sources.map((id) => `${base}:source:${id}`), ...claims.map((id) => `${base}:claim:${id}`)];
    return [["SET", base, JSON.stringify(parsed), "EX", ttl], ...keys.map((key): RedisCommand => ["EXPIRE", key, ttl])];
  });
}

export async function createRun(
  linkedInUrl: string,
  hints?: ResearchRun["hints"],
  options?: { allowManualUrl?: boolean },
): Promise<ResearchRun> {
  const normalized = normalizeUrl(linkedInUrl);
  if (!options?.allowManualUrl && !isLinkedInProfileUrl(linkedInUrl)) {
    throw new AppError("invalid_url", "A public LinkedIn profile URL is required.");
  }
  if (options?.allowManualUrl) {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      throw new AppError("invalid_url", "Manual fallback URLs must use HTTPS.");
    }
  }
  const now = new Date().toISOString();
  const run: ResearchRun = {
    id: createRunId(), linkedInUrl: normalized, stage: "created", createdAt: now, updatedAt: now,
    progress: { sourcesDiscovered: 0, sourcesFetched: 0, claimsExtracted: 0, checksCompleted: 0, verifiedClaims: 0, excludedClaims: 0 },
    warnings: [], completedStageKeys: [],
    ...(hints ? { hints } : {}),
  };
  await withRedis(async (redis) => {
    const saved = await redis.set(redisKey("run", run.id), JSON.stringify(run), "EX", runRetentionSeconds(run), "NX");
    if (!saved) throw new AppError("validation_failed", "A run with this ID already exists.", 409);
  });
  return run;
}

export async function saveRun(run: ResearchRun, lockToken?: string): Promise<ResearchRun> {
  return withRunLock(run.id, async (token) => {
    const previous = await requirePersistedRun(run.id);
    if ((run.diagnostic?.reviewStatus === "approved" || run.approvedAt || run.stage === "approved" || run.stage === "completed") &&
      (previous.diagnostic?.reviewStatus !== "approved" ||
        hashJson(run.diagnostic ?? null) !== hashJson(previous.diagnostic) ||
        run.approvedAt !== previous.approvedAt || run.approvedBy !== previous.approvedBy)) {
      throw new AppError("approval_not_allowed", "Diagnostic approval requires a separately audited snapshot. Run updates cannot restore export approval.", 409);
    }
    const updated = researchRunSchema.parse({ ...run, createdAt: previous.createdAt, updatedAt: new Date().toISOString(),
      completedStageKeys: [...new Set([...previous.completedStageKeys, ...run.completedStageKeys])] });
    await commitRunCommands(run.id, token, await runWriteCommands(updated));
    return updated;
  }, lockToken);
}

export async function completeStage(runId: string, stageKey: string, nextStage: ResearchRun["stage"], lockToken?: string): Promise<ResearchRun> {
  if (!stageKey.trim()) throw new AppError("validation_failed", "A checkpoint key is required.");
  return withRunLock(runId, async (token) => {
    const run = await requirePersistedRun(runId);
    if (run.completedStageKeys.includes(stageKey)) return run;
    return saveRun({ ...run, stage: nextStage, completedStageKeys: [...run.completedStageKeys, stageKey] }, token);
  }, lockToken);
}

export async function appendEvent(runId: string, event: ExecutionEvent, lockToken?: string): Promise<void> {
  const parsed = executionEventSchema.parse({ ...event, message: redactSecrets(event.message), data: sanitizeEventData(event.data) });
  await withRunLock(runId, async (token) => {
    const run = await requirePersistedRun(runId);
    const key = redisKey("run", runId, "events");
    const updated = { ...run, updatedAt: new Date().toISOString(),
      ...(run.pipeline ? { pipeline: { ...run.pipeline, eventSequence: run.pipeline.eventSequence + 1 } } : {}) };
    await commitRunCommands(runId, token, [["RPUSH", key, JSON.stringify(parsed)], ["LTRIM", key, -MAX_RUN_EVENTS, -1], ...await runWriteCommands(updated)]);
  }, lockToken);
}

export async function getEvents(runId: string): Promise<ExecutionEvent[]> {
  const loaded = await loadRun(runId);
  if (!loaded) return [];
  if (loaded.fixtureMode) return getDemoFixture()!.events;
  return withRedis(async (redis) => (await redis.lrange(redisKey("run", runId, "events"), 0, -1)).map((value) => parseStored(value, executionEventSchema.parse)));
}

export async function deleteRun(runId: string): Promise<void> {
  await withRunLock(runId, async (token) => {
    await requirePersistedRun(runId);
    const base = redisKey("run", runId);
    const keys = await withRedis(async (redis) => {
      const [sources, claims] = await Promise.all([redis.smembers(`${base}:sources`), redis.smembers(`${base}:claims`)]);
      return [base, `${base}:sources`, `${base}:claims`, `${base}:events`, `${base}:snapshot`,
        ...sources.map((id) => `${base}:source:${id}`), ...claims.map((id) => `${base}:claim:${id}`)];
    });
    await commitRunCommands(runId, token, [["DEL", ...keys]]);
  });
}
