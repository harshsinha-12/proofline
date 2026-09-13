import "server-only";
import { getEnv } from "@/lib/env";
import { AppError, toSafeError } from "@/lib/errors";
import { eventId } from "@/lib/ids";
import { appendEvent, requirePersistedRun, saveRun, withRunLock } from "@/lib/run-store";
import { getSources } from "@/lib/source-store";
import { getClaims, saveClaim } from "@/lib/claim-store";
import { researchRunSchema, type ResearchRun } from "@/schemas/run";
import { classifyClaim } from "@/pipeline/classify-claims";
import { resolveIdentity } from "@/pipeline/resolve-identity";
import { planResearch } from "@/pipeline/plan-research";
import { discoverSources } from "@/pipeline/discover-sources";
import { extractSources } from "@/pipeline/extract-sources";
import { extractClaims } from "@/pipeline/extract-claims";
import { verifyPassOne } from "@/pipeline/verify-pass-one";
import { planAdversarialChecks } from "@/pipeline/plan-adversarial-checks";
import { verifyPassTwo } from "@/pipeline/verify-pass-two";
import { defaultServices, type PipelineContext, type PipelineServices, type StageResult } from "@/pipeline/shared";

export type AdvanceResult = {
  runId: string; previousStage: ResearchRun["stage"]; stage: ResearchRun["stage"]; progress: ResearchRun["progress"];
  warnings: ResearchRun["warnings"]; canContinue: boolean; retryAfter?: string;
};

const STOP_STAGES = new Set(["awaiting_human_review", "failed", "completed"]);

function response(run: ResearchRun, previousStage: ResearchRun["stage"], canContinue = true): AdvanceResult {
  return { runId: run.id, previousStage, stage: run.stage, progress: run.progress, warnings: run.warnings,
    canContinue: canContinue && !STOP_STAGES.has(run.stage), ...(run.retryAfter ? { retryAfter: run.retryAfter } : {}) };
}

async function classifyRun(context: PipelineContext): Promise<StageResult> {
  const sources = await getSources(context.run.id);
  const claims = await getClaims(context.run.id);
  const claim = claims.find((claim) => !context.run.completedStageKeys.includes(`classified:${claim.id}`));
  if (!claim) return { nextStage: "analyzing_gaps", key: "classification:complete" };
  await saveClaim(context.run.id, { ...claim, ...classifyClaim(claim, { sources, identityAmbiguous: context.run.identityStatus !== "resolved" }), updatedAt: new Date().toISOString() }, context.token);
  return { key: `classified:${claim.id}` };
}

const HANDLERS: Partial<Record<ResearchRun["stage"], (context: PipelineContext) => Promise<StageResult>>> = {
  resolving_identity: resolveIdentity, planning_research: planResearch, discovering_sources: discoverSources,
  extracting_sources: extractSources, extracting_claims: extractClaims, verifying_pass_1: verifyPassOne,
  planning_adversarial_checks: planAdversarialChecks, verifying_pass_2: verifyPassTwo, classifying_claims: classifyRun,
  // Human approval precedes analysis/writing; the review flow calls draftDiagnostic.
  analyzing_gaps: async () => ({ nextStage: "drafting_diagnostic", key: "gaps:deferred_to_review" }),
  drafting_diagnostic: async () => ({ nextStage: "awaiting_human_review", key: "draft:deferred_to_review" }),
};

export async function advanceRun(runId: string, services: PipelineServices = defaultServices, hints?: ResearchRun["hints"]): Promise<AdvanceResult> {
  return withRunLock(runId, async (token) => {
    let run = await requirePersistedRun(runId);
    const previousStage = run.stage;
    if (STOP_STAGES.has(run.stage)) return response(run, previousStage, false);
    if (hints && run.stage === "resolving_identity") {
      run = await saveRun({ ...run, hints: { ...run.hints, ...hints }, identityStatus: undefined, retryAfter: undefined }, token);
    } else if (run.identityStatus && run.identityStatus !== "resolved") return response(run, previousStage, false);
    if (run.retryAfter && Date.parse(run.retryAfter) > Date.now()) return response(run, previousStage, false);
    const pipeline = researchRunSchema.shape.pipeline.unwrap().parse(run.pipeline ?? {});
    const context: PipelineContext = { run, token, services, pipeline, record: async (event) => {
      const latest = await requirePersistedRun(runId);
      const at = new Date().toISOString();
      await appendEvent(runId, { id: eventId(runId, (latest.pipeline?.eventSequence ?? 0) + 1), at,
        stage: run.stage, type: event.type, message: event.message, data: event.data }, token);
    } };
    try {
      let result: StageResult;
      if (run.stage === "created") {
        getEnv();
        result = { nextStage: "resolving_identity", key: "run:started" };
      } else if (run.stage === "approved") result = { nextStage: "completed", key: "run:completed", patch: { completedAt: new Date().toISOString() } };
      else {
        const handler = HANDLERS[run.stage];
        if (!handler) throw new AppError("not_implemented", "This pipeline stage is not available.", 501);
        result = await handler(context);
      }
      const sources = await getSources(runId); const claims = await getClaims(runId);
      const current = await requirePersistedRun(runId);
      pipeline.eventSequence = current.pipeline?.eventSequence ?? pipeline.eventSequence;
      const updated = await saveRun({ ...current, ...result.patch, pipeline,
        stage: result.nextStage ?? run.stage, retryAfter: undefined,
        completedStageKeys: [...new Set([...current.completedStageKeys, ...(result.key ? [result.key] : [])])],
        progress: { sourcesDiscovered: sources.length, sourcesFetched: sources.filter((source) => source.fetchStatus === "fetched").length,
          claimsExtracted: claims.length, checksCompleted: claims.reduce((total, claim) => total + Number(!!claim.check1) + Number(!!claim.check2), 0),
          verifiedClaims: claims.filter((claim) => claim.status === "verified").length,
          excludedClaims: claims.filter((claim) => claim.status !== "pending" && claim.status !== "verified").length },
      }, token);
      await context.record!({ type: "stage_checkpoint", message: "Saved a bounded pipeline checkpoint.", data: { previousStage, stage: updated.stage } });
      return response(updated, previousStage, result.canContinue ?? true);
    } catch (error) {
      if (error instanceof AppError && ["redis_unavailable", "lock_held", "not_found", "read_only"].includes(error.code)) throw error;
      const safe = { ...toSafeError(error), stage: run.stage };
      const recoverable = error instanceof AppError && ["rate_limited", "provider_unavailable", "invalid_env"].includes(error.code);
      pipeline.attempts[run.stage] = (pipeline.attempts[run.stage] ?? 0) + 1;
      const terminal = !recoverable && pipeline.attempts[run.stage] >= 3;
      await context.record!({ type: "stage_failed", message: safe.message, data: { attempt: pipeline.attempts[run.stage], stage: run.stage } });
      const current = await requirePersistedRun(runId);
      pipeline.eventSequence = current.pipeline?.eventSequence ?? pipeline.eventSequence;
      const updated = await saveRun({ ...current, pipeline,
        stage: terminal ? "failed" : run.stage, ...(terminal ? { fatalError: safe } : {}),
        retryAfter: terminal ? undefined : new Date(Date.now() + (error instanceof AppError && error.code === "rate_limited" ? 60_000 : 10_000)).toISOString(),
        warnings: [...current.warnings.slice(-49), { code: safe.code, message: safe.message, createdAt: safe.createdAt }],
      }, token);
      return response(updated, previousStage, false);
    }
  });
}
