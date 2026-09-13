import { mutate } from "@/pipeline/shared";
import * as prompt from "@/prompts/source-authority";
import type { Claim } from "@/schemas/claim";
import type { Source } from "@/schemas/source";
import { getSource, saveSource } from "@/lib/source-store";
import { AppError } from "@/lib/errors";
import { preservePageSourceKind } from "@/lib/source-kind";
import { subjectInput, toExcerpt, type PipelineContext } from "@/pipeline/shared";

export async function assessSource(context: PipelineContext, claim: Claim, source: Source, otherSources: Source[], key: string) {
  const contract = prompt.forKnownOrigins(otherSources.map((entry) => entry.id));
  const output = await context.services.requestStructured(contract, { ...subjectInput(context.run), claim: claim.statement, source: toExcerpt(source), otherSources: otherSources.map(toExcerpt) }, context);
  if (output.derivedFromSourceId && !otherSources.some((entry) => entry.id === output.derivedFromSourceId)) throw new AppError("validation_failed", "Authority assessment cites an unknown origin.", 422);
  await mutate(context, async () => {
    source = await getSource(context.run.id, source.id) ?? source;
    const sourceKind = preservePageSourceKind(source.sourceKind, output.sourceKind, source.canonicalUrl || source.url, context.run.subject?.organization);
    await saveSource(context.run.id, { ...source, sourceKind,
      ...(output.derivedFromSourceId && !source.suspectedOriginId ? { suspectedOriginId: output.derivedFromSourceId } : {}),
      notes: [...new Set([...source.notes, ...(output.suspectedSharedOrigin ? [output.derivationNote] : [])])] }, context.token);
    context.pipeline.authorityDecisions[key] = {
      sourceAuthorityForClaim: output.sourceAuthorityForClaim,
      suspectedSharedOrigin: output.suspectedSharedOrigin,
      derivationNote: output.derivationNote,
      reasoning: output.reasoning,
      sourceKind,
    };
  });
}
