import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryRedis } from "./helpers/memory-redis";
import { makeClaim, makeSource, makeDiagnostic, currentTimestamp, verifiedClaims } from "./helpers/fixtures";

const state = vi.hoisted(() => ({ redis: undefined as MemoryRedis | undefined }));
vi.mock("@/lib/redis", async () => {
  const { MemoryRedis } = await import("./helpers/memory-redis");
  state.redis = new MemoryRedis();
  return { getRedis: () => state.redis, redisKey: (...parts: string[]) => ["proofline:test", ...parts].join(":") };
});
vi.mock("@/lib/demo-fixture", async (original) => ({ ...await original<typeof import("@/lib/demo-fixture")>(), getDemoFixture: vi.fn(() => null) }));

import { acquireRunLock, releaseRunLock, appendEvent, completeStage, createRun, deleteRun, getEvents, getRun, loadRun, saveRun, commitRunCommands } from "@/lib/run-store";
import { getClaim, getClaims, saveClaim, updateClaimReview, approveAllVerifiedClaims } from "@/lib/claim-store";
import { getSource, getSources, saveSource } from "@/lib/source-store";
import { getDemoFixture, parseDemoFixture } from "@/lib/demo-fixture";
import { resetEnvCache } from "@/lib/env";
import { generateAuditedDraft, approveDiagnostic, getApprovedSnapshot } from "@/lib/diagnostic-store";

beforeEach(() => {
  state.redis!.reset();
  for (const [key, value] of Object.entries({ REDIS_USERNAME: "default", REDIS_PASSWORD: "test", REDIS_HOST: "localhost", REDIS_PORT: "6379" })) vi.stubEnv(key, value);
  resetEnvCache();
  vi.mocked(getDemoFixture).mockReturnValue(null);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); resetEnvCache(); });

describe("Redis evidence stores", () => {
  it("accepts an explicit HTTPS manual fallback that is not a LinkedIn URL", async () => {
    const run = await createRun("https://www.stake.com/about", undefined, { allowManualUrl: true });
    expect(run.linkedInUrl).toBe("https://www.stake.com/about");
    await expect(createRun("https://www.stake.com/about")).rejects.toMatchObject({ code: "invalid_url" });
  });
  it("round-trips run metadata, sources, claims and events", async () => {
    const run = await createRun("https://www.linkedin.com/in/alex");
    expect(await getRun(run.id)).toEqual(run);
    const source = makeSource(); const claim = makeClaim();
    await saveSource(run.id, source); await saveClaim(run.id, claim);
    const event = { id: "event_a", at: currentTimestamp(), stage: "created" as const, type: "stage", message: "Started." };
    await appendEvent(run.id, event);
    expect(await getSource(run.id, source.id)).toEqual(source);
    expect(await getClaim(run.id, claim.id)).toEqual(claim);
    expect(await getEvents(run.id)).toEqual([event]);
  });
  it("upserts deterministic IDs without duplicating ledger members", async () => {
    const run = await createRun("linkedin.com/in/alex");
    await saveSource(run.id, makeSource()); await saveSource(run.id, makeSource());
    await saveClaim(run.id, makeClaim()); await saveClaim(run.id, makeClaim());
    expect(await getSources(run.id)).toHaveLength(1); expect(await getClaims(run.id)).toHaveLength(1);
  });
  it("preserves checkpoints and makes a repeated completed stage a no-op", async () => {
    const run = await createRun("linkedin.com/in/alex");
    const updated = await completeStage(run.id, "identity:v1", "planning_research");
    expect(await completeStage(run.id, "identity:v1", "failed")).toEqual(updated);
    const stale = await saveRun({ ...run, stage: "planning_research" });
    expect(stale.completedStageKeys).toEqual(["identity:v1"]);
  });
  it("caps append-only events at the latest 500 entries", async () => {
    const run = await createRun("linkedin.com/in/alex");
    const token = await acquireRunLock(run.id);
    try {
      for (let index = 0; index < 505; index++) await appendEvent(run.id, { id: `event_${index}`, at: currentTimestamp(), stage: "created", type: "stage", message: `Event ${index}` }, token);
    } finally { await releaseRunLock(run.id, token); }
    const events = await getEvents(run.id);
    expect(events).toHaveLength(500); expect(events[0].id).toBe("event_5"); expect(events[499].id).toBe("event_504");
  });
  it("returns 409 on contention and cannot release another owner's lock", async () => {
    const run = await createRun("linkedin.com/in/alex");
    const token = await acquireRunLock(run.id);
    await expect(acquireRunLock(run.id)).rejects.toMatchObject({ code: "lock_held", status: 409 });
    expect(await releaseRunLock(run.id, "wrong")).toBe(false);
    expect(await releaseRunLock(run.id, token)).toBe(true);
  });
  it("fences stale workers after a lock expires and is replaced", async () => {
    vi.useFakeTimers();
    const run = await createRun("linkedin.com/in/alex");
    const old = await acquireRunLock(run.id);
    vi.advanceTimersByTime(91_000);
    const current = await acquireRunLock(run.id);
    await expect(commitRunCommands(run.id, old, [["SET", "proofline:test:danger", "stale"]])).rejects.toMatchObject({ code: "lock_held" });
    expect(await state.redis!.get("proofline:test:danger")).toBeNull();
    expect(await releaseRunLock(run.id, old)).toBe(false);
    expect(await releaseRunLock(run.id, current)).toBe(true);
  });
  it("refreshes retention on run metadata, entities, indexes and events", async () => {
    vi.useFakeTimers();
    const run = await createRun("linkedin.com/in/alex");
    await saveSource(run.id, makeSource()); await saveClaim(run.id, makeClaim());
    await appendEvent(run.id, { id: "event", at: currentTimestamp(), stage: "created", type: "stage", message: "Started." });
    vi.advanceTimersByTime(600_000);
    await completeStage(run.id, "step", "resolving_identity");
    for (const suffix of ["", ":sources", ":claims", ":events", ":source:source_a", ":claim:claim_a"]) {
      expect(await state.redis!.ttl(`proofline:test:run:${run.id}${suffix}`)).toBe(604_800);
    }
  });
  it("rejects ineligible review through the store and bulk-approves only verified claims", async () => {
    const run = await createRun("linkedin.com/in/alex");
    await saveClaim(run.id, makeClaim({ status: "partially_verified" }));
    await expect(updateClaimReview(run.id, "claim_a", "approved")).rejects.toMatchObject({ code: "approval_not_allowed" });
    await saveClaim(run.id, makeClaim({ id: "verified", status: "verified" }));
    await approveAllVerifiedClaims(run.id);
    expect((await getClaim(run.id, "verified"))!.humanDecision).toBe("approved");
    expect((await getClaim(run.id, "claim_a"))!.humanDecision).toBe("pending");
  });
  it("an evidence edit resets human review and invalidates export and snapshot", async () => {
    const run = await createRun("linkedin.com/in/alex");
    const claim = makeClaim({ status: "verified", humanDecision: "approved" });
    await saveClaim(run.id, claim);
    const approved = { ...run, stage: "approved" as const, approvedAt: currentTimestamp(), approvedBy: "Reviewer", diagnostic: makeDiagnostic({ reviewStatus: "approved" }) };
    await state.redis!.set(`proofline:test:run:${run.id}`, JSON.stringify(approved));
    await state.redis!.set(`proofline:test:run:${run.id}:snapshot`, "snapshot");
    const edited = await saveClaim(run.id, { ...claim, statement: "Alex founded Another Company." });
    expect(edited.humanDecision).toBe("pending");
    const updated = await getRun(run.id);
    expect(updated?.diagnostic?.reviewStatus).toBe("draft"); expect(updated?.stage).toBe("awaiting_human_review"); expect(updated?.approvedAt).toBeUndefined();
    expect(await state.redis!.get(`proofline:test:run:${run.id}:snapshot`)).toBeNull();
    await expect(saveRun(approved)).rejects.toMatchObject({ code: "approval_not_allowed" });
  });
  it("redacts secrets and drops raw page/provider/chain-of-thought payloads from events", async () => {
    const run = await createRun("linkedin.com/in/alex");
    await appendEvent(run.id, { id: "event", at: currentTimestamp(), stage: "created", type: "error", message: "Bearer abcdefghijk", data: { query: "sk-secret123", rawHtml: "RAW", chainOfThought: "PRIVATE", rawProviderPayload: "PAYLOAD", latencyMs: 50 } });
    const events = await getEvents(run.id);
    expect(events[0].message).toBe("[redacted]");
    expect(events[0].data).toEqual({ query: "[redacted]", latencyMs: 50 });
  });
  it("deletes a run and its bounded ledger keys", async () => {
    const run = await createRun("linkedin.com/in/alex");
    await saveSource(run.id, makeSource()); await saveClaim(run.id, makeClaim());
    await deleteRun(run.id);
    expect(await getRun(run.id)).toBeNull();
    expect([...state.redis!.values.keys()].some((key) => key.includes(run.id))).toBe(false);
  });
  it("wraps infrastructure errors without exposing credentials", async () => {
    vi.spyOn(state.redis!, "get").mockRejectedValueOnce(new Error("REDIS_PASSWORD=private"));
    await expect(getRun("missing")).rejects.toMatchObject({ code: "redis_unavailable", status: 503, safeMessage: expect.not.stringContaining("private") });
  });
  it("cannot edit an approved diagnostic through generic run updates", async () => {
    const run = await createRun("linkedin.com/in/alex");
    const approved = { ...run, stage: "approved" as const, approvedAt: currentTimestamp(), approvedBy: "Reviewer", diagnostic: makeDiagnostic({ reviewStatus: "approved" }) };
    await state.redis!.set(`proofline:test:run:${run.id}`, JSON.stringify(approved));
    await expect(saveRun({ ...approved, diagnostic: { ...approved.diagnostic, currentPositioning: "Unaudited rewrite." } })).rejects.toMatchObject({ code: "approval_not_allowed" });
  });
  it("fails closed if an indexed ledger entity is missing", async () => {
    const run = await createRun("linkedin.com/in/alex");
    await saveClaim(run.id, makeClaim());
    state.redis!.values.delete(`proofline:test:run:${run.id}:claim:claim_a`);
    await expect(getClaims(run.id)).rejects.toMatchObject({ code: "validation_failed" });
  });
  it("only uses a validated demo fixture for the demo ID and blocks fixture writes", async () => {
    const run = await createRun("linkedin.com/in/alex");
    const data = parseDemoFixture({ run: { ...run, id: "demo", stage: "completed", approvedAt: currentTimestamp(), approvedBy: "Harsh Sinha", diagnostic: makeDiagnostic({ reviewStatus: "approved" }) },
      claims: verifiedClaims(), sources: [makeSource()], events: [] });
    expect(data).not.toBeNull();
    vi.mocked(getDemoFixture).mockReturnValue(data);
    expect((await loadRun("demo"))?.fixtureMode).toBe(true);
    expect(await getRun("other_missing")).toBeNull();
    expect(await getClaims("demo")).toEqual(data!.claims);
    await expect(saveClaim("demo", makeClaim())).rejects.toMatchObject({ code: "read_only" });
    expect(parseDemoFixture({ run: null })).toBeNull();
  });
  it("retains failed diagnostic audits in the execution ledger before saving a valid retry as a draft", async () => {
    const run = await createRun("linkedin.com/in/alex");
    for (const claim of verifiedClaims()) await saveClaim(run.id, claim);
    await saveRun({ ...run, stage: "awaiting_human_review" });
    const generate = vi.fn().mockResolvedValueOnce(makeDiagnostic({ currentPositioning: "Alex #founder" })).mockResolvedValueOnce(makeDiagnostic({ reviewStatus: "approved" }));
    const result = await generateAuditedDraft(run.id, generate);
    expect(result.status).toBe("ok");
    expect((await getRun(run.id))?.diagnostic?.reviewStatus).toBe("draft");
    const events = await getEvents(run.id);
    expect(events).toHaveLength(1); expect(events[0].type).toBe("diagnostic_audit_failed"); expect(events[0].data?.attempt).toBe(1);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("writes an immutable snapshot that generic run updates cannot restore after invalidation", async () => {
    const run = await createRun("linkedin.com/in/alex");
    for (const claim of verifiedClaims()) await saveClaim(run.id, claim);
    await saveRun({ ...run, stage: "awaiting_human_review", diagnostic: makeDiagnostic({ reviewStatus: "draft" }) });
    const approved = await approveDiagnostic(run.id, true, "Harsh Sinha");
    expect(approved.run.stage).toBe("approved");
    expect(approved.run.diagnostic?.reviewStatus).toBe("approved");
    const snapshot = await getApprovedSnapshot(run.id);
    expect(snapshot?.hash).toBe(approved.snapshotHash);
    await expect(approveDiagnostic(run.id, true, "Harsh Sinha")).rejects.toMatchObject({ code: "approval_not_allowed" });
    await updateClaimReview(run.id, "identity", "excluded");
    expect(await getApprovedSnapshot(run.id)).toBeNull();
    expect((await getRun(run.id))?.stage).toBe("awaiting_human_review");
  });
});
