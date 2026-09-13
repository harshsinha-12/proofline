import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryRedis } from "./helpers/memory-redis";

const state = vi.hoisted(() => ({ redis: undefined as MemoryRedis | undefined }));
vi.mock("@/lib/redis", async () => {
  const { MemoryRedis } = await import("./helpers/memory-redis");
  state.redis = new MemoryRedis();
  return { getRedis: () => state.redis, redisKey: (...parts: string[]) => ["proofline:reliability-test", ...parts].join(":") };
});
vi.mock("@/lib/env", () => ({ getEnv: () => ({ MAX_SOURCES_PER_RUN: 18, MAX_CLAIMS_PER_RUN: 1, RUN_RETENTION_SECONDS: 2_592_000 }) }));

import { createRun, getRun, acquireRunLock, releaseRunLock } from "@/lib/run-store";
import { getSources } from "@/lib/source-store";
import { getClaims } from "@/lib/claim-store";
import { advanceRun } from "@/pipeline/advance-run";
import { AppError } from "@/lib/errors";
import { mockServices } from "./phase-2-pipeline.test";

beforeEach(() => { state.redis!.reset(); });

describe("reliability", () => {
  it("preserves a timed-out fetch after resume and does not duplicate the source", async () => {
    const run = await createRun("https://www.linkedin.com/in/alex-example");
    const services = mockServices();
    vi.mocked(services.fetchPage).mockImplementation(async (url) => {
      if (url.includes("official")) {
        return { url, title: url, fetchStatus: "timed_out" as const, retrievedAt: new Date().toISOString(), notes: ["Extraction failed after one retry; failure remains in the source ledger."] };
      }
      return { url, title: "Public record", textExcerpt: "Alex Example is the founder of Example. Alex Example founded Example.", fetchStatus: "fetched" as const, retrievedAt: new Date().toISOString(), notes: [] };
    });
    for (let index = 0; index < 80; index++) if (!(await advanceRun(run.id, services)).canContinue) break;
    const sources = await getSources(run.id);
    const timedOut = sources.filter((source) => source.fetchStatus === "timed_out");
    expect(timedOut.length).toBeGreaterThan(0);
    const before = sources.map((source) => source.id).sort().join(",");
    await advanceRun(run.id, services);
    await advanceRun(run.id, services);
    expect((await getSources(run.id)).map((source) => source.id).sort().join(",")).toBe(before);
    expect((await getSources(run.id)).filter((source) => source.fetchStatus === "timed_out").map((source) => source.id)).toEqual(timedOut.map((source) => source.id));
    expect(await getClaims(run.id)).toHaveLength(1);
    expect((await getRun(run.id))?.stage).toBe("awaiting_human_review");
  });

  it("returns lock contention without advancing the checkpoint", async () => {
    const run = await createRun("https://www.linkedin.com/in/alex-example");
    const token = await acquireRunLock(run.id);
    const services = mockServices();
    try {
      await expect(advanceRun(run.id, services)).rejects.toMatchObject({ code: "lock_held", status: 409 });
    } finally {
      await releaseRunLock(run.id, token);
    }
    expect(services.search).not.toHaveBeenCalled();
    expect((await getRun(run.id))?.stage).toBe("created");
  });

  it("saves a rate-limit checkpoint that can resume", async () => {
    const run = await createRun("https://www.linkedin.com/in/alex-example");
    const services = mockServices();
    vi.mocked(services.search).mockRejectedValueOnce(new AppError("rate_limited", "Resume shortly.", 429));
    await advanceRun(run.id, services);
    const paused = await advanceRun(run.id, services);
    expect(paused.retryAfter).toBeDefined();
    expect((await getRun(run.id))?.stage).toBe("resolving_identity");
  });
});
