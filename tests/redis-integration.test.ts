import Redis from "ioredis";
import { afterAll, describe, expect, it, vi } from "vitest";
import { makeClaim, makeSource, now } from "./helpers/fixtures";

const state = vi.hoisted(() => ({ client: undefined as Redis | undefined, prefix: `proofline:integration:${Date.now()}` }));
vi.mock("@/lib/redis", async () => {
  const { default: Redis } = await import("ioredis");
  if (process.env.REDIS_TEST_SOCKET) state.client = new Redis(process.env.REDIS_TEST_SOCKET, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  return { getRedis: () => state.client!, redisKey: (...parts: string[]) => [state.prefix, ...parts].join(":") };
});
vi.mock("@/lib/env", () => ({ getEnv: () => ({ RUN_RETENTION_SECONDS: 2_592_000 }) }));

import { acquireRunLock, releaseRunLock, appendEvent, completeStage, createRun, deleteRun, getEvents, getRun, commitRunCommands } from "@/lib/run-store";
import { getClaims, saveClaim } from "@/lib/claim-store";
import { getSources, saveSource } from "@/lib/source-store";

afterAll(async () => { if (state.client) await state.client.quit(); });

describe.skipIf(!process.env.REDIS_TEST_SOCKET)("local Redis socket integration", () => {
  it("round-trips ledgers, runs Lua commits, caps events, and replays checkpoints safely", async () => {
    const run = await createRun("linkedin.com/in/alex");
    try {
      await saveSource(run.id, makeSource()); await saveClaim(run.id, makeClaim());
      expect(await getSources(run.id)).toEqual([makeSource()]); expect(await getClaims(run.id)).toEqual([makeClaim()]);
      const token = await acquireRunLock(run.id);
      await expect(acquireRunLock(run.id)).rejects.toMatchObject({ status: 409 });
      expect(await releaseRunLock(run.id, "wrong_owner")).toBe(false);
      try {
        for (let index = 0; index < 505; index++) await appendEvent(run.id, { id: `event_${index}`, at: now, stage: "created", type: "stage", message: "Progress." }, token);
      } finally { await releaseRunLock(run.id, token); }
      expect(await getEvents(run.id)).toHaveLength(500);
      const checkpoint = await completeStage(run.id, "identity:v1", "planning_research");
      expect(await completeStage(run.id, "identity:v1", "failed")).toEqual(checkpoint);
      expect((await getRun(run.id))?.completedStageKeys).toEqual(["identity:v1"]);
      for (const suffix of ["", ":sources", ":claims", ":events", ":source:source_a", ":claim:claim_a"]) {
        expect(await state.client!.ttl(`${state.prefix}:run:${run.id}${suffix}`)).toBeGreaterThan(604_790);
      }
    } finally { await deleteRun(run.id); }
  });
  it("rejects an expired lock's writes with real Redis Lua fencing", async () => {
    const run = await createRun("linkedin.com/in/alex");
    try {
      const stale = await acquireRunLock(run.id);
      await state.client!.del(`${state.prefix}:run:${run.id}:lock`);
      const current = await acquireRunLock(run.id);
      await expect(commitRunCommands(run.id, stale, [["SET", `${state.prefix}:stale_write`, "bad"]])).rejects.toMatchObject({ code: "lock_held" });
      expect(await state.client!.get(`${state.prefix}:stale_write`)).toBeNull();
      expect(await releaseRunLock(run.id, stale)).toBe(false);
      await releaseRunLock(run.id, current);
    } finally { await deleteRun(run.id); }
  });
});
