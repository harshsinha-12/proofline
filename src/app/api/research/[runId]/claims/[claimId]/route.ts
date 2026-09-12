import { NextResponse } from "next/server";
import { z } from "zod";
import { updateClaimReview } from "@/lib/claim-store";
import { toClientError } from "@/lib/errors";
import { humanDecisionSchema } from "@/schemas/claim";

const reviewSchema = z.object({ decision: humanDecisionSchema, note: z.string().max(2_000).optional() }).strict();

export async function PATCH(request: Request, context: RouteContext<"/api/research/[runId]/claims/[claimId]">) {
  const body = await request.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_failed", message: "A valid review decision and optional note are required." } }, { status: 400 });
  try {
    const { runId, claimId } = await context.params;
    const claim = await updateClaimReview(runId, claimId, parsed.data.decision, parsed.data.note);
    return NextResponse.json({ claim });
  } catch (error) {
    const safe = toClientError(error);
    return NextResponse.json({ error: { code: safe.code, message: safe.message } }, { status: safe.status });
  }
}
