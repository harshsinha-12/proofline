import { mutate } from "@/pipeline/shared";
import * as prompt from "@/prompts/claim-extraction";
import { getClaims, saveClaim } from "@/lib/claim-store";
import { getSources } from "@/lib/source-store";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { claimIdFromStatement } from "@/lib/ids";
import { parseQuantities } from "@/lib/numbers";
import { subjectId, subjectInput, toExcerpt, taskDone, type PipelineContext, type StageResult } from "@/pipeline/shared";

export async function extractClaims(context: PipelineContext): Promise<StageResult> {
  const sources = (await getSources(context.run.id)).filter((source) => source.fetchStatus === "fetched" && source.textExcerpt);
  const source = sources.find((source) => context.targetId ? source.id === context.targetId : !taskDone(context, `claims:extracted:${source.id}`));
  const existing = await getClaims(context.run.id);
  const maxClaims = getEnv().MAX_CLAIMS_PER_RUN;
  if (!source || existing.length >= maxClaims) return { nextStage: "verifying_pass_1", key: "claims:complete" };
  await context.record?.({ type: "claim_extraction_started", message: "Extracting claims from this public page.", data: { sourceId: source.id, url: source.canonicalUrl } });
  const output = await context.services.requestStructured(prompt, { ...subjectInput(context.run), sources: [toExcerpt(source)],
    existingClaims: existing.map(({ statement, originSourceIds }) => ({ statement, originSourceIds })), maxClaims: Math.min(context.claimBudget ?? maxClaims, maxClaims - existing.length) }, context);
  if (output.claims.length > maxClaims - existing.length) throw new AppError("validation_failed", "Extraction exceeded the claim budget.", 422);
  for (const extracted of output.claims) {
    if (!extracted.originSourceIds.includes(source.id) || extracted.originSourceIds.some((id) => id !== source.id && !existing.some((claim) => claim.originSourceIds.includes(id))) ||
      !source.textExcerpt!.includes(extracted.excerpt)) {
      await context.record?.({ type: "claim_extraction_rejected", message: "Discarded a claim without a matching exact source excerpt; continuing with other claims and pages.", data: { sourceId: source.id, url: source.canonicalUrl, statement: extracted.statement } });
      continue;
    }
    const id = claimIdFromStatement(subjectId(context.run), extracted.statement);
    await mutate(context, async () => {
      const latest = await getClaims(context.run.id);
      const previous = latest.find((claim) => claim.id === id);
      if (!previous && latest.length >= maxClaims) return;
      const now = new Date().toISOString();
      await saveClaim(context.run.id, { id, subjectId: subjectId(context.run), statement: extracted.statement, category: extracted.category,
        materiality: extracted.materiality, containsNumber: parseQuantities(extracted.statement).length > 0,
        timeSensitive: extracted.timeSensitive, ...(extracted.asOfDate ? { asOfDate: extracted.asOfDate } : {}),
        originSourceIds: [...new Set([...(previous?.originSourceIds ?? []), ...extracted.originSourceIds])], status: "pending",
        statusReason: "Awaiting both verification passes.", humanDecision: "pending", createdAt: previous?.createdAt ?? now, updatedAt: now }, context.token);
    });
  }
  return { key: `claims:extracted:${source.id}` };
}
