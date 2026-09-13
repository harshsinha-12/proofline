import "server-only";
import { getWriterInput } from "@/lib/diagnostic-audit";
import { getClaims } from "@/lib/claim-store";
import { getSources } from "@/lib/source-store";
import { AppError } from "@/lib/errors";
import { shortHash } from "@/lib/hashing";
import * as prompt from "@/prompts/gap-analysis";
import type { PipelineContext } from "@/pipeline/shared";

export async function analyzeGaps(context: PipelineContext, roleLimitation?: string) {
  const input = getWriterInput(await getClaims(context.run.id), roleLimitation);
  if (input.status !== "ok") return input;
  const sources = await getSources(context.run.id);
  const result = await context.services.requestStructured(prompt, {
    currentDate: new Date().toISOString().slice(0, 10),
    facts: input.facts.map((fact) => ({ ...fact, asOfDate: fact.asOfDate ?? null })),
    sample: sources.map(({ id, sourceKind, fetchStatus, discoveryQuery }) => ({ sourceId: id, sourceKind, fetchStatus, discoveryQuery })),
  }, context);
  const claims = new Set(input.facts.map((fact) => fact.id));
  const sample = new Set(sources.map((source) => source.id));
  for (const gap of result.gaps) {
    if ((!gap.supportingClaimIds.length && !gap.sampledSourceIds.length) ||
      gap.supportingClaimIds.some((id) => !claims.has(id)) || gap.sampledSourceIds.some((id) => !sample.has(id))) {
      throw new AppError("validation_failed", "Gap citations must reference approved facts or the recorded source sample.", 422);
    }
  }
  return { status: "ok" as const, gaps: result.gaps.map((gap, index) => ({ ...gap, id: `gap_${shortHash(`${context.run.id}:${index}:${gap.title}`)}` })) };
}
