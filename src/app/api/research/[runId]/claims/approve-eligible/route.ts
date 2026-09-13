import { NextResponse } from "next/server";
import { approveAllVerifiedClaims } from "@/lib/claim-store";
import { apiError } from "@/lib/api";

export async function POST(_request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    const claims = await approveAllVerifiedClaims(runId);
    return NextResponse.json({ claims }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
