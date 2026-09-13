import { NextResponse } from "next/server";
import { reclassifyPersistedRun } from "@/pipeline/reclassify-run";
import { apiError } from "@/lib/api";

export const maxDuration = 90;

export async function POST(_request: Request, context: RouteContext<"/api/research/[runId]/reclassify">) {
  try {
    const { runId } = await context.params;
    const result = await reclassifyPersistedRun(runId);
    return NextResponse.json({
      runId: result.run.id,
      stage: result.run.stage,
      progress: result.run.progress,
      counts: result.counts,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
