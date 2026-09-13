import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MemoryRedis } from "./helpers/memory-redis";
import type { PromptContract } from "@/providers/types";

const state = vi.hoisted(() => ({ redis: undefined as MemoryRedis | undefined }));
vi.mock("@/lib/redis", async () => {
  const { MemoryRedis } = await import("./helpers/memory-redis"); state.redis = new MemoryRedis();
  return { getRedis: () => state.redis, redisKey: (...parts: string[]) => ["proofline:pipeline-test", ...parts].join(":") };
});
vi.mock("@/lib/env", () => ({ getEnv: () => ({ MAX_SOURCES_PER_RUN: 18, MAX_CLAIMS_PER_RUN: 1, RUN_RETENTION_SECONDS: 2_592_000 }) }));

import { createRun, getRun, getEvents, acquireRunLock, releaseRunLock, saveRun, withRunLock, requirePersistedRun } from "@/lib/run-store";
import { getClaims, updateClaimReview, saveClaim } from "@/lib/claim-store";
import { getSources, saveSource } from "@/lib/source-store";
import { getWriterInput } from "@/lib/diagnostic-audit";
import { advanceRun } from "@/pipeline/advance-run";
import { draftDiagnostic } from "@/pipeline/draft-diagnostic";
import { verifyPassTwo } from "@/pipeline/verify-pass-two";
import type { PipelineContext, PipelineServices } from "@/pipeline/shared";
import type { requestStructured } from "@/providers/ai";
import { researchRunSchema } from "@/schemas/run";
import { AppError } from "@/lib/errors";
import { verifiedClaims, makeClaim, makeSource, makeCheck, makeDiagnostic } from "./helpers/fixtures";

beforeEach(() => { state.redis!.reset(); });

export function mockServices(contradict = false): PipelineServices {
  const statement = "Alex Example founded Example.";
  const request = async (contract: PromptContract, raw: unknown) => {
    const input = contract.inputSchema.parse(raw) as Record<string, unknown>;
    const source = input.source as { sourceId: string; textExcerpt: string } | undefined;
    let output: unknown;
    switch (contract.purpose) {
      case "identity": {
        const sources = input.sources as { sourceId: string }[];
        const ids = [sources[0].sourceId];
        output = { status: "resolved", fullName: "Alex Example", currentRole: "founder", organization: "Example", location: null,
          canonicalLinkedInUrl: "https://www.linkedin.com/in/alex-example", aliases: [], fieldEvidence: { fullName: ids, currentRole: ids, organization: ids, location: [] }, ambiguityNotes: [] };
        break;
      }
      case "research_plan": output = { queries: Array.from({ length: 8 }, (_, index) => ({ query: `Alex Example ${index}`, purpose: index === 7 ? "contradiction or recency" : "professional history", preferredSourceType: "institutional_first_party", domainHint: null })) }; break;
      case "claim_extraction": output = { claims: [{ statement, category: "company", materiality: "low", containsNumber: false, timeSensitive: false, asOfDate: null,
        originSourceIds: [(input.sources as { sourceId: string }[])[0].sourceId], excerpt: statement }] }; break;
      case "source_authority": output = { sourceAuthorityForClaim: "qualifying", suspectedSharedOrigin: false, derivationNote: "", reasoning: "Original public record.", sourceKind: "institutional_first_party", derivedFromSourceId: null }; break;
      case "verification_one": output = { verdict: "supported", excerpt: statement, supportsExactly: statement, sourceAuthorityForClaim: "qualifying", reasoning: "Exact public evidence.", limitations: [] }; break;
      case "adversarial_plan": output = { queries: [{ query: "second independent primary", intent: "independent_primary" }, { query: "second contradiction recency", intent: "contradiction_or_recency" }] }; break;
      case "verification_two": output = { verdict: contradict ? "contradicted" : "supported", excerpt: contradict ? "Alex Example did not found Example." : statement,
        supportsExactly: statement, sourceAuthorityForClaim: "qualifying", independenceFromOtherCheck: "independent", reasoning: "Independent record checked.", limitations: [] }; break;
      default: throw new Error(`Unexpected model purpose ${contract.purpose}`);
    }
    if (source && !source.textExcerpt) throw new Error("Missing excerpt.");
    return contract.outputSchema.parse(output);
  };
  return {
    search: vi.fn(async ({ query }) => [{ title: "Public record", url: query.startsWith("second") ? "https://official.example/alex" : "https://company.example/alex", snippet: "" }]),
    fetchPage: vi.fn(async (url) => ({ url, title: "Public record", textExcerpt: url.includes("official") ? (contradict ? "Official record: Alex Example did not found Example." : `Official independent record: ${statement}`) : `Alex Example is the founder of Example. ${statement}`,
      fetchStatus: "fetched" as const, retrievedAt: new Date().toISOString(), notes: [] })),
    requestStructured: vi.fn(request) as unknown as typeof requestStructured,
  };
}

describe("single-claim vertical slice", () => {
  it("discards nonmatching extraction evidence without repeatedly failing the run", async () => {
    const run = await createRun("https://www.linkedin.com/in/alex-example");
    const services = mockServices();
    const original = services.requestStructured;
    services.requestStructured = vi.fn(async (contract, input, context) => {
      const output = await original(contract, input, context);
      if (contract.purpose === "claim_extraction") return { claims: [{ statement: "Invented claim", category: "company", materiality: "low", containsNumber: false, timeSensitive: false, asOfDate: null, originSourceIds: [(input as { sources: { sourceId: string }[] }).sources[0].sourceId], excerpt: "This quote is not in the page." }] };
      return output;
    }) as typeof services.requestStructured;
    for (let index = 0; index < 80; index++) {
      const result = await advanceRun(run.id, services);
      if (!result.canContinue) break;
    }
    expect((await getRun(run.id))?.stage).toBe("awaiting_human_review");
    expect(await getClaims(run.id)).toHaveLength(0);
    const event = (await getEvents(run.id)).find((event) => event.type === "claim_extraction_rejected");
    expect(event?.data?.url).toBe("https://company.example/alex");
  });
  it.each([false, true])("persists both checks and explicit inclusion/exclusion, contradiction=%s", async (contradict) => {
    const run = await createRun("https://www.linkedin.com/in/alex-example");
    const services = mockServices(contradict);
    for (let index = 0; index < 80; index++) {
      const result = await advanceRun(run.id, services);
      if (!result.canContinue) break;
    }
    const completed = await getRun(run.id);
    expect(completed?.stage).toBe("awaiting_human_review");
    const claims = await getClaims(run.id);
    expect(claims).toHaveLength(1); expect(claims[0].check1).toBeDefined(); expect(claims[0].check2).toBeDefined();
    expect(claims[0].status).toBe(contradict ? "conflict" : "verified");
    if (contradict) await expect(updateClaimReview(run.id, claims[0].id, "approved")).rejects.toMatchObject({ code: "approval_not_allowed" });
    else expect((await updateClaimReview(run.id, claims[0].id, "approved")).humanDecision).toBe("approved");
    expect(getWriterInput(await getClaims(run.id)).status).toBe("insufficient_evidence");
    const modelCalls = vi.mocked(services.requestStructured).mock.calls.length;
    await advanceRun(run.id, services); await advanceRun(run.id, services);
    expect(await getClaims(run.id)).toHaveLength(1); expect(await getSources(run.id)).toHaveLength(2);
    expect(vi.mocked(services.requestStructured).mock.calls.length).toBe(modelCalls);
    expect((await getEvents(run.id)).some((event) => event.type === "stage_checkpoint")).toBe(true);
  });
  it("uses broader discovery after failed pages and resolves from fetched fallback evidence", async () => {
    const run = await createRun("https://www.linkedin.com/in/alex-example");
    const services = mockServices();
    vi.mocked(services.search).mockResolvedValueOnce([{ title: "Unavailable", url: "https://unavailable.example/alex", snippet: "Alex Example" }]);
    vi.mocked(services.fetchPage).mockResolvedValueOnce({ url: "https://unavailable.example/alex", title: "Unavailable", fetchStatus: "failed", retrievedAt: new Date().toISOString(), notes: ["dns_failure"] });
    await advanceRun(run.id, services);
    for (let index = 0; index < 10; index++) {
      await advanceRun(run.id, services, index === 0 ? { name: "Alex Example", company: "Example" } : undefined);
      if ((await getRun(run.id))?.identityStatus === "resolved") break;
    }
    expect((await getRun(run.id))?.identityStatus).toBe("resolved");
    expect(services.search).toHaveBeenCalledTimes(2);
    expect(vi.mocked(services.search).mock.calls[0][0].query).toContain('"Alex Example" "Example"');
    expect((await getSources(run.id)).find((source) => source.url.includes("unavailable"))?.fetchStatus).toBe("failed");
  });
  it("bounds discovery and never promotes search snippets when all pages fail", async () => {
    const run = await createRun("https://www.linkedin.com/in/alex-example");
    const services = mockServices();
    vi.mocked(services.search).mockImplementation(async ({ query }) => [{ title: "Record", url: `https://public.example/${encodeURIComponent(query)}`, snippet: "Alex Example founder Example" }]);
    vi.mocked(services.fetchPage).mockImplementation(async (url) => ({ url, title: "Record", fetchStatus: "failed", retrievedAt: new Date().toISOString(), notes: ["timeout"] }));
    for (let index = 0; index < 20; index++) if (!(await advanceRun(run.id, services)).canContinue) break;
    expect((await getRun(run.id))?.identityStatus).toBe("insufficient_evidence");
    expect(services.search).toHaveBeenCalledTimes(3);
    expect(services.requestStructured).not.toHaveBeenCalled();
    await advanceRun(run.id, services);
    expect(services.search).toHaveBeenCalledTimes(3);
    // A changed hint starts fresh discovery and retries previously examined candidates.
    await advanceRun(run.id, services, { name: "Alex Example" });
    expect(services.search).toHaveBeenCalledTimes(4);
  });
  it("returns lock contention without making provider calls", async () => {
    const run = await createRun("linkedin.com/in/alex-example"); const token = await acquireRunLock(run.id); const services = mockServices();
    try { await expect(advanceRun(run.id, services)).rejects.toMatchObject({ code: "lock_held", status: 409 }); }
    finally { await releaseRunLock(run.id, token); }
    expect(services.search).not.toHaveBeenCalled();
  });
  it("retains a failed search checkpoint and resumes without duplicate sources", async () => {
    const run = await createRun("https://www.linkedin.com/in/alex-example"); const services = mockServices();
    vi.mocked(services.search).mockRejectedValueOnce(new AppError("rate_limited", "Resume shortly.", 429));
    await advanceRun(run.id, services);
    const failed = await advanceRun(run.id, services);
    expect(failed.stage).toBe("resolving_identity"); expect(failed.retryAfter).toBeDefined();
    expect((await getRun(run.id))?.pipeline?.attempts.resolving_identity).toBe(1);
    await advanceRun(run.id, services);
    expect(services.search).toHaveBeenCalledTimes(1);
    await saveRun({ ...await requirePersistedRun(run.id), retryAfter: undefined });
    for (let index = 0; index < 80; index++) if (!(await advanceRun(run.id, services)).canContinue) break;
    const resumed = await getRun(run.id);
    expect(resumed?.stage, JSON.stringify(resumed?.warnings)).toBe("awaiting_human_review");
    expect(await getClaims(run.id)).toHaveLength(1); expect(await getSources(run.id)).toHaveLength(2);
    expect((await getEvents(run.id)).some((event) => event.type === "stage_failed")).toBe(true);
  });
  it("recovers an examined second check and prefers exact support over narrower support", async () => {
    const run = await createRun("https://www.linkedin.com/in/alex-example");
    const first = makeSource(); const second = makeSource("source_b");
    const claim = makeClaim({ check1: makeCheck(1, first) });
    await saveSource(run.id, first); await saveSource(run.id, second); await saveClaim(run.id, claim);
    const services = mockServices();
    await withRunLock(run.id, async (token) => {
      const current = await requirePersistedRun(run.id);
      const pipeline = researchRunSchema.shape.pipeline.unwrap().parse({
        adversarialPlans: { [claim.id]: { queries: [{ query: "independent", intent: "independent_primary" }] } },
        verificationCandidates: { [claim.id]: [second.id] },
        secondChecks: { [claim.id]: [makeCheck(2, second, "Alex was involved."), makeCheck(2, second, claim.statement)] },
      });
      await verifyPassTwo({ run: { ...current, completedStageKeys: [`check2:search:${claim.id}:0`, `check2:examined:${claim.id}:${second.id}`] }, pipeline, token, services });
    });
    expect((await getClaims(run.id))[0].check2?.evidence[0].supportsExactly).toBe(claim.statement);
    expect(services.requestStructured).not.toHaveBeenCalled(); expect(services.search).not.toHaveBeenCalled();
  });
});

describe("approved-fact analysis and writer", () => {
  async function prepared() {
    const run = await createRun("linkedin.com/in/alex-example");
    await saveSource(run.id, makeSource());
    for (const claim of [...verifiedClaims(), makeClaim({ id: "banned", statement: "Banned outside fact with 999 clients.", status: "unverified" })]) await saveClaim(run.id, claim);
    await saveRun({ ...await requirePersistedRun(run.id), stage: "awaiting_human_review" });
    return run;
  }
  async function invoke(runId: string, services: PipelineServices) {
    return withRunLock(runId, async (token) => {
      const run = await requirePersistedRun(runId);
      const context: PipelineContext = { run, token, services, pipeline: researchRunSchema.shape.pipeline.unwrap().parse({}) };
      return draftDiagnostic(context);
    });
  }
  function writerServices(invalidFirst = false, refusal = false) {
    const services = mockServices(); let attempts = 0;
    services.requestStructured = vi.fn(async (contract: PromptContract, raw: unknown) => {
      const input = contract.inputSchema.parse(raw) as Record<string, unknown>;
      expect(JSON.stringify(input.facts)).not.toContain("999"); expect(JSON.stringify(input.facts)).not.toContain("banned");
      if (contract.purpose === "gap_analysis") return contract.outputSchema.parse({ gaps: makeDiagnostic().gaps.map(({ id: _id, ...gap }) => gap) });
      if (refusal) return contract.outputSchema.parse({ status: "insufficient_evidence", diagnostic: null });
      attempts++;
      return contract.outputSchema.parse({ status: "ok", diagnostic: makeDiagnostic({
        generatedAt: input.generatedAt as string, integritySummary: input.integritySummary as ReturnType<typeof makeDiagnostic>["integritySummary"],
        gaps: input.gaps as ReturnType<typeof makeDiagnostic>["gaps"],
        credibilitySignals: Array.from({ length: 3 }, () => ({ text: "Alex leads Example.", claimIds: ["role"] })),
        narrativeOpportunity: invalidFirst && attempts === 1 ? "Invented 999 clients." : "Explain the documented leadership role.",
      }) });
    }) as unknown as typeof requestStructured;
    return services;
  }
  it("filters unapproved facts, records an invalid draft, and persists only its audited retry", async () => {
    const run = await prepared(); const services = writerServices(true);
    const result = await invoke(run.id, services);
    expect(result.status).toBe("ok");
    expect((await getRun(run.id))?.diagnostic?.reviewStatus).toBe("draft");
    expect((await getRun(run.id))?.diagnostic?.narrativeOpportunity).not.toContain("999");
    expect((await getEvents(run.id)).filter((event) => event.type === "diagnostic_audit_failed")).toHaveLength(1);
    expect(services.requestStructured).toHaveBeenCalledTimes(3);
  });
  it("returns explicit model refusal without a diagnostic", async () => {
    const run = await prepared();
    expect((await invoke(run.id, writerServices(false, true))).status).toBe("insufficient_evidence");
    expect((await getRun(run.id))?.diagnostic).toBeUndefined();
  });
  it("skips all analysis and writer calls when approvals are insufficient", async () => {
    const run = await prepared(); const services = writerServices();
    await updateClaimReview(run.id, "identity", "excluded");
    expect((await invoke(run.id, services)).status).toBe("insufficient_evidence");
    expect(services.requestStructured).not.toHaveBeenCalled();
  });
  it("rejects a gap citing a claim outside the approved fact set", async () => {
    const run = await prepared(); const services = writerServices();
    vi.mocked(services.requestStructured).mockResolvedValueOnce({ gaps: makeDiagnostic().gaps.map(({ id: _id, ...gap }) => ({ ...gap, supportingClaimIds: ["banned"] })) });
    await expect(invoke(run.id, services)).rejects.toMatchObject({ code: "validation_failed" });
    expect(services.requestStructured).toHaveBeenCalledTimes(1); expect((await getRun(run.id))?.diagnostic).toBeUndefined();
  });
});
