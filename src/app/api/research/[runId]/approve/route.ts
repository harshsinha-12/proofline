import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { approveDiagnostic } from "@/lib/diagnostic-store";

const bodySchema = z.object({
  confirmation: z.literal(true),
  reviewerName: z.string().min(1).max(120),
}).strict();

export async function POST(request: Request, context: RouteContext<"/api/research/[runId]/approve">) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_failed", message: "Export approval requires confirmation and a reviewer name." } },
      { status: 400 },
    );
  }
  try {
    const { runId } = await context.params;
    const result = await approveDiagnostic(runId, parsed.data.confirmation, parsed.data.reviewerName);
    const run = { ...result.run };
    delete run.pipeline;
    return NextResponse.json({ run, snapshotHash: result.snapshotHash }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
