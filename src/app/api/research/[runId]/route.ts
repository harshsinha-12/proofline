import { NextResponse } from "next/server";
import { loadRun, getEvents } from "@/lib/run-store";
import { getSources } from "@/lib/source-store";
import { getClaims } from "@/lib/claim-store";
import { apiError } from "@/lib/api";

export async function GET(_request: Request, context: RouteContext<"/api/research/[runId]">) {
  try {
    const { runId } = await context.params;
    const loaded = await loadRun(runId);
    if (!loaded) return NextResponse.json({ error: { code: "not_found", message: "Research run not found." } }, { status: 404 });
    const [sources, claims, events] = await Promise.all([getSources(runId), getClaims(runId), getEvents(runId)]);
    const run = { ...loaded.run };
    delete run.pipeline;
    return NextResponse.json({ run, sources, claims, events, fixtureMode: loaded.fixtureMode }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
