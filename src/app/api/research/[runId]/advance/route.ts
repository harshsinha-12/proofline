import { NextResponse } from "next/server";
import { z } from "zod";
import { advanceRun } from "@/pipeline/advance-run";
import { apiError } from "@/lib/api";

export const maxDuration = 90;
const hintsSchema = z.object({ nameHint: z.string().max(150).optional(), companyHint: z.string().max(150).optional() }).strict();

export async function POST(request: Request, context: RouteContext<"/api/research/[runId]/advance">) {
  const text = await request.text();
  let body: unknown = {};
  try { if (text) body = JSON.parse(text); } catch { body = null; }
  const parsed = hintsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "validation_failed", message: "Only optional name and company hints are accepted." } }, { status: 400 });
  try {
    const { runId } = await context.params;
    const hints = parsed.data.nameHint || parsed.data.companyHint ? { name: parsed.data.nameHint, company: parsed.data.companyHint } : undefined;
    const result = await advanceRun(runId, undefined, hints);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
