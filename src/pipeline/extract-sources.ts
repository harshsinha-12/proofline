import { getSources } from "@/lib/source-store";
import { extractSource, isPendingSource, taskDone, type PipelineContext, type StageResult } from "@/pipeline/shared";

export async function extractSources(context: PipelineContext): Promise<StageResult> {
  const sources = await getSources(context.run.id);
  const pending = sources.find((source) => context.targetId ? source.id === context.targetId : !taskDone(context, `source:extracted:${source.id}`));
  if (!pending || sources.filter((source) => source.fetchStatus === "fetched").length >= 15) return { nextStage: "extracting_claims", key: "sources:complete" };
  if (isPendingSource(pending)) await extractSource(context, pending);
  return { key: `source:extracted:${pending.id}` };
}
