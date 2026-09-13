import * as prompt from "@/prompts/adversarial-plan";
import { getClaims } from "@/lib/claim-store";
import { AppError } from "@/lib/errors";
import { subjectInput, type PipelineContext, type StageResult } from "@/pipeline/shared";

export async function planAdversarialChecks(context: PipelineContext): Promise<StageResult> {
  const claim = (await getClaims(context.run.id)).find((claim) => !context.pipeline.adversarialPlans[claim.id]);
  if (!claim) return { nextStage: "verifying_pass_2", key: "adversarial:complete" };
  const avoidDomains = [...new Set(claim.check1?.evidence.map((ref) => new URL(ref.url).hostname) ?? [])];
  const output = await context.services.requestStructured(prompt, { ...subjectInput(context.run), claim: claim.statement, check1: claim.check1 ?? null, avoidDomains }, context);
  if (!output.queries.some((query) => query.intent === "independent_primary") || !output.queries.some((query) => query.intent === "contradiction_or_recency")) {
    throw new AppError("validation_failed", "Adversarial planning must include independent-primary and contradiction/recency checks.", 422);
  }
  context.pipeline.adversarialPlans[claim.id] = output;
  return { key: `adversarial:${claim.id}` };
}
