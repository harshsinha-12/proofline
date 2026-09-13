import { getClaims } from "@/lib/claim-store";
import { getSources } from "@/lib/source-store";
import { getEnv } from "@/lib/env";
import type { PipelineContext, StageResult } from "@/pipeline/shared";
import type { PipelineServices } from "@/pipeline/shared";
import pLimit from "p-limit";
import { prioritizeClaims } from "@/lib/claim-research";

export function batchServices(services: PipelineServices): PipelineServices {
  const searches = new Map<string, ReturnType<PipelineServices["search"]>>();
  const pages = new Map<string, ReturnType<PipelineServices["fetchPage"]>>();
  const domains = new Map<string, ReturnType<typeof pLimit>>();
  return {
    ...services,
    search(request, context) {
      const key = JSON.stringify({ ...request, query: request.query.trim().replace(/\s+/g, " ") });
      let result = searches.get(key);
      if (!result) { result = services.search(request, context); searches.set(key, result); }
      return result;
    },
    fetchPage(url, context) {
      let result = pages.get(url);
      if (!result) {
        const host = new URL(url).hostname;
        const limit = domains.get(host) ?? pLimit(1);
        domains.set(host, limit);
        result = limit(() => {
          context?.signal?.throwIfAborted();
          return services.fetchPage(url, context);
        });
        pages.set(url, result);
      }
      return result;
    },
  };
}

// Network work overlaps; writes to the shared run ledger remain ordered.
export function serialQueue() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.then(work);
    tail = result.catch(() => undefined);
    return result;
  };
}

export async function batchTargets(context: PipelineContext): Promise<Partial<PipelineContext>[]> {
  const stage = context.run.stage;
  const size = context.pipeline.attempts[stage] ? 1 : 3;
  if (stage === "discovering_sources") return context.pipeline.queries
    .map((_, queryIndex) => ({ queryIndex })).filter(({ queryIndex }) => !context.run.completedStageKeys.includes(`discovery:${queryIndex}`)).slice(0, size);
  if (stage === "extracting_sources" || stage === "extracting_claims") {
    const sources = await getSources(context.run.id);
    const extracting = stage === "extracting_claims";
    const room = extracting ? Math.max(0, getEnv().MAX_CLAIMS_PER_RUN - (await getClaims(context.run.id)).length) : Math.max(0, 15 - sources.filter((s) => s.fetchStatus === "fetched").length);
    const selected = sources.filter((s) => (!extracting || s.fetchStatus === "fetched" && s.textExcerpt) &&
      !context.run.completedStageKeys.includes(`${extracting ? "claims" : "source"}:extracted:${s.id}`)).slice(0, Math.min(size, room));
    return selected.map((s) => ({ targetId: s.id, ...(extracting ? { claimBudget: Math.max(1, Math.floor(room / selected.length)) } : {}) }));
  }
  if (["verifying_pass_1", "planning_adversarial_checks", "verifying_pass_2"].includes(stage)) {
    return prioritizeClaims(await getClaims(context.run.id)).filter((c) => stage === "verifying_pass_1" ? !c.check1 : stage === "verifying_pass_2" ? !c.check2 : !context.pipeline.adversarialPlans[c.id])
      .slice(0, size).map((c) => ({ targetId: c.id }));
  }
  return [];
}

export async function runBatch(context: PipelineContext, handler: (context: PipelineContext) => Promise<StageResult>, checkpoint: (result: StageResult) => Promise<void>): Promise<StageResult> {
  const targets = await batchTargets(context);
  if (!targets.length) return handler(context);
  await context.record?.({ type: "batch_started", message: `Processing ${targets.length} independent tasks concurrently.`, data: { count: targets.length } });
  const results = await Promise.allSettled(targets.map(async (target) => {
    const result = await handler({ ...context, ...target });
    await checkpoint(result);
    return result;
  }));
  const failed = results.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return {};
}
