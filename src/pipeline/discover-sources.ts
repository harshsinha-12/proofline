import { persistCandidates, taskDone, type PipelineContext, type StageResult } from "@/pipeline/shared";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";

export async function discoverSources(context: PipelineContext): Promise<StageResult> {
  const index = context.pipeline.queries.findIndex((_, index) => !taskDone(context, `discovery:${index}`));
  if (index < 0) return { nextStage: "extracting_sources", key: "discovery:complete" };
  const query = context.pipeline.queries[index];
  const domain = query.domainHint?.replace(/^https?:\/\//, "").split("/")[0];
  if (domain && !/^[a-z0-9.-]+$/i.test(domain)) throw new AppError("validation_failed", "Research plan contains an invalid domain hint.", 422);
  const results = await context.services.search({ query: query.query, maxResults: 3, ...(domain ? { allowedDomains: [domain] } : {}), blockedDomains: ["linkedin.com"] }, context);
  await persistCandidates(context, results, query.query, Math.max(3, Math.floor(getEnv().MAX_SOURCES_PER_RUN * 2 / 3)));
  return { key: `discovery:${index}` };
}
