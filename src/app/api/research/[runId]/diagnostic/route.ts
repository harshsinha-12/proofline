import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { generateReviewDiagnostic } from "@/pipeline/review-run";

export const maxDuration = 90;
const bodySchema = z.object({ roleLimitation: z.string().max(500).optional() }).strict();

export async function POST(request: Request, context: RouteContext<"/api/research/[runId]/diagnostic">) {
  const text = await request.text();
  let body: unknown = {};
  try { if (text) body = JSON.parse(text); } catch { body = null; }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation_failed", message: "Only an optional role limitation is accepted." } }, { status: 400 });
  }
  try {
    const { runId } = await context.params;
    const result = await generateReviewDiagnostic(runId, parsed.data.roleLimitation, request.signal);
    if (result.status !== "ok") {
      return NextResponse.json({ status: result.status, reason: result.reason }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ status: "ok", diagnostic: result.diagnostic }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
