import * as prompt from "@/prompts/research-plan";
import { AppError } from "@/lib/errors";
import { subjectInput, type PipelineContext, type StageResult } from "@/pipeline/shared";

export async function planResearch(context: PipelineContext): Promise<StageResult> {
  const output = await context.services.requestStructured(prompt, { ...subjectInput(context.run), queryBudget: 8 }, context);
  if (output.queries.length !== 8 || !output.queries.some((query) => /contradict|correct|recen|current|latest/i.test(query.purpose))) {
    throw new AppError("validation_failed", "Research plan must honor the eight-query budget and include a recency or contradiction check.", 422);
  }
  context.pipeline.queries = output.queries.map(({ domainHint, ...query }) => ({ ...query, ...(domainHint ? { domainHint } : {}) }));
  return { nextStage: "discovering_sources", key: "research:plan" };
}
