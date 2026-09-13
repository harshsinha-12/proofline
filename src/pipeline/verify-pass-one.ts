import { mutate } from "@/pipeline/shared";
import * as prompt from "@/prompts/verification-one";
import { getClaims, saveClaim } from "@/lib/claim-store";
import { getSources } from "@/lib/source-store";
import { AppError } from "@/lib/errors";
import { checkId } from "@/lib/ids";
import { assessSource } from "@/pipeline/assess-source";
import { emptyCheck, subjectInput, toExcerpt, type PipelineContext, type StageResult } from "@/pipeline/shared";

export async function verifyPassOne(context: PipelineContext): Promise<StageResult> {
  const claim = (await getClaims(context.run.id)).find((claim) => context.targetId ? claim.id === context.targetId : !claim.check1);
  if (!claim) return { nextStage: "planning_adversarial_checks", key: "check1:complete" };
  const sources = await getSources(context.run.id);
  const source = sources.find((source) => claim.originSourceIds.includes(source.id) && source.fetchStatus === "fetched" && source.textExcerpt);
  const key = `authority:1:${claim.id}`;
  if (!source) {
    await mutate(context, () => saveClaim(context.run.id, { ...claim, check1: emptyCheck(claim, 1, "No accessible origin page supports a direct check.") }, context.token));
    return { key: `check1:${claim.id}` };
  }
  if (!context.pipeline.authorityDecisions[key]) {
    await assessSource(context, claim, source, [], key);
    return { key };
  }
  const authority = context.pipeline.authorityDecisions[key];
  const output = await context.services.requestStructured(prompt, { ...subjectInput(context.run), claim: claim.statement, source: toExcerpt(source), authority: authority.sourceAuthorityForClaim }, context);
  if (output.verdict !== "no_evidence" && (!output.excerpt || !source.textExcerpt!.includes(output.excerpt))) throw new AppError("validation_failed", "Verifier returned an excerpt absent from the source.", 422);
  const check1 = { id: checkId(claim.id, 1), pass: 1 as const, verdict: output.verdict,
    evidence: output.excerpt ? [{ sourceId: source.id, url: source.url, title: source.title, excerpt: output.excerpt, supportsExactly: output.supportsExactly }] : [],
    sourceAuthorityForClaim: authority.sourceAuthorityForClaim, independenceFromOtherCheck: authority.suspectedSharedOrigin ? "possibly_derived" as const : "independent" as const,
    reasoning: output.reasoning, limitations: output.limitations, checkedAt: new Date().toISOString() };
  await mutate(context, () => saveClaim(context.run.id, { ...claim, check1 }, context.token));
  return { key: `check1:${claim.id}` };
}
