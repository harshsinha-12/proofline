import "server-only";
import { eventId } from "@/lib/ids";
import { appendEvent, requirePersistedRun, withRunLock } from "@/lib/run-store";
import { researchRunSchema } from "@/schemas/run";
import { defaultServices, type PipelineContext } from "@/pipeline/shared";
import { draftDiagnostic } from "@/pipeline/draft-diagnostic";

export async function generateReviewDiagnostic(runId: string, roleLimitation?: string, signal?: AbortSignal) {
  return withRunLock(runId, async (token) => {
    const run = await requirePersistedRun(runId);
    const pipeline = researchRunSchema.shape.pipeline.unwrap().parse(run.pipeline ?? {});
    const context: PipelineContext = {
      run,
      token,
      services: defaultServices,
      pipeline,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(75_000)]) : AbortSignal.timeout(75_000),
      record: async (event) => {
        const latest = await requirePersistedRun(runId);
        const at = new Date().toISOString();
        await appendEvent(runId, {
          id: eventId(runId, (latest.pipeline?.eventSequence ?? 0) + 1),
          at,
          stage: latest.stage,
          type: event.type,
          message: event.message,
          data: event.data,
        }, token);
      },
    };
    return draftDiagnostic(context, roleLimitation);
  });
}
