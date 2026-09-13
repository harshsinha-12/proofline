import { getEnv } from "@/lib/env";
import { targetedQuery } from "@/lib/claim-research";
import { mutate } from "@/pipeline/shared";
import * as prompt from "@/prompts/verification-two";
import { getClaims, saveClaim } from "@/lib/claim-store";
import { getSources } from "@/lib/source-store";
import { AppError } from "@/lib/errors";
import { checkId } from "@/lib/ids";
import type { VerificationCheck } from "@/schemas/verification";
import { checksShareOrigin } from "@/pipeline/classify-claims";
import { assessSource } from "@/pipeline/assess-source";
import { emptyCheck, extractSource, isPendingSource, persistCandidates, subjectInput, toExcerpt, taskDone, type PipelineContext, type StageResult } from "@/pipeline/shared";

function strongestCheck(checks: VerificationCheck[], statement: string): VerificationCheck | undefined {
  const rank = (check: VerificationCheck) => check.verdict === "contradicted" && check.sourceAuthorityForClaim !== "not_qualifying" ? 4
    : check.verdict === "supported" && check.independenceFromOtherCheck === "independent" && check.sourceAuthorityForClaim !== "not_qualifying" &&
      !check.limitations.length && check.evidence.some((ref) => ref.supportsExactly.trim() === statement.trim()) ? 3
    : check.verdict === "partially_supported" ? 2 : check.verdict === "supported" ? 1 : 0;
  return [...checks].sort((a, b) => rank(b) - rank(a))[0];
}

export async function verifyPassTwo(context: PipelineContext): Promise<StageResult> {
  const claim = (await getClaims(context.run.id)).find((claim) => context.targetId ? claim.id === context.targetId : !claim.check2);
  if (!claim) return { nextStage: "classifying_claims", key: "check2:complete" };
  const sourceBudget = getEnv().MAX_SOURCES_PER_RUN + (getEnv().MAX_VERIFICATION_EXTRA_SOURCES ?? 12);
  const plan = context.pipeline.adversarialPlans[claim.id];
  if (!plan) throw new AppError("validation_failed", "Claim has no adversarial search plan.", 422);
  const queryIndex = plan.queries.findIndex((_, index) => !taskDone(context, `check2:search:${claim.id}:${index}`));
  if (queryIndex >= 0) {
    const query = plan.queries[queryIndex];
    const avoidDomains = query.intent === "independent_primary" ? [...new Set(claim.check1?.evidence.map((ref) => new URL(ref.url).hostname) ?? [])] : [];
    const results = await context.services.search({ query: query.query, maxResults: 2, blockedDomains: ["linkedin.com", ...avoidDomains] }, context);
    const ids = await persistCandidates(context, results, query.query, sourceBudget);
    context.pipeline.verificationCandidates[claim.id] = [...new Set([...(context.pipeline.verificationCandidates[claim.id] ?? []), ...ids])].slice(0, 6);
    return { key: `check2:search:${claim.id}:${queryIndex}` };
  }
  const sources = await getSources(context.run.id);
  const candidates = sources.filter((source) => (context.pipeline.verificationCandidates[claim.id] ?? []).includes(source.id));
  const pending = candidates.find(isPendingSource);
  if (pending) {
    await extractSource(context, pending);
    return { key: `check2:fetch:${claim.id}:${pending.id}` };
  }
  const firstIds = claim.check1?.evidence.map((ref) => ref.sourceId) ?? [];
  const fetched = candidates.filter((source) => source.fetchStatus === "fetched" && source.textExcerpt && !firstIds.includes(source.id));
  // Inspect every bounded candidate, including contradictory results, rather than stopping at the first support.
  const source = fetched.find((source) => !taskDone(context, `check2:examined:${claim.id}:${source.id}`));
  if (!source) {
    const checks = context.pipeline.secondChecks[claim.id] ?? [];
    const conclusive = checks.some((check) => check.verdict === "contradicted" || check.verdict === "supported" && check.independenceFromOtherCheck === "independent" && check.limitations.length === 0);
    const fallbackKey = `check2:targeted:${claim.id}`;
    if (!conclusive && !taskDone(context, fallbackKey) && candidates.length < 6 && sources.length < sourceBudget) {
      const query = targetedQuery(claim, context.run.subject!.fullName, context.run.subject?.organization);
      await context.record?.({ type: "targeted_search", message: "Existing sources did not establish independent support; trying one targeted follow-up search.", data: { claimId: claim.id, query } });
      const blockedDomains = [...new Set(["linkedin.com", ...(claim.check1?.evidence.map((ref) => new URL(ref.url).hostname) ?? [])])];
      const results = await context.services.search({ query, maxResults: Math.min(2, 6 - candidates.length), blockedDomains }, context);
      const ids = await persistCandidates(context, results, query, sourceBudget);
      context.pipeline.verificationCandidates[claim.id] = [...new Set([...(context.pipeline.verificationCandidates[claim.id] ?? []), ...ids])].slice(0, 6);
      return { key: fallbackKey };
    }
    const reason = sources.length >= sourceBudget
      ? "The run source budget was exhausted before independent confirmation could be established."
      : "No accessible replacement source established an independent second check within the source budget.";
    if (!conclusive) await context.record?.({ type: "verification_inconclusive", message: reason, data: { claimId: claim.id, count: candidates.length } });
    const check2 = strongestCheck(checks, claim.statement) ?? emptyCheck(claim, 2, reason);
    await mutate(context, () => saveClaim(context.run.id, { ...claim, check2 }, context.token));
    return { key: `check2:${claim.id}` };
  }
  const key = `authority:2:${claim.id}:${source.id}`;
  if (!context.pipeline.authorityDecisions[key]) {
    await assessSource(context, claim, source, sources.filter((entry) => firstIds.includes(entry.id)), key);
    return { key };
  }
  const authority = context.pipeline.authorityDecisions[key];
  const output = await context.services.requestStructured(prompt, { ...subjectInput(context.run), claim: claim.statement, check1: claim.check1 ?? null,
    source: toExcerpt(source), authority: authority.sourceAuthorityForClaim, firstSources: sources.filter((entry) => firstIds.includes(entry.id)).map(toExcerpt) }, context);
  if (output.verdict !== "no_evidence" && (!output.excerpt || !source.textExcerpt!.includes(output.excerpt))) throw new AppError("validation_failed", "Second verifier returned an excerpt absent from the public source.", 422);
  const check2 = { id: checkId(claim.id, 2), pass: 2 as const, verdict: output.verdict,
    evidence: output.excerpt ? [{ sourceId: source.id, url: source.url, title: source.title, excerpt: output.excerpt, supportsExactly: output.supportsExactly }] : [],
    sourceAuthorityForClaim: authority.sourceAuthorityForClaim, independenceFromOtherCheck: output.independenceFromOtherCheck,
    reasoning: output.reasoning, limitations: output.limitations, checkedAt: new Date().toISOString() };
  if (claim.check1 && checksShareOrigin(claim.check1, check2, sources)) check2.independenceFromOtherCheck = "same_origin";
  if (authority.suspectedSharedOrigin && check2.independenceFromOtherCheck === "independent") check2.independenceFromOtherCheck = "possibly_derived";
  context.pipeline.secondChecks[claim.id] = [...(context.pipeline.secondChecks[claim.id] ?? []), check2];
  return { key: `check2:examined:${claim.id}:${source.id}` };
}
