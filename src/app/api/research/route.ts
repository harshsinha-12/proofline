import { NextResponse } from "next/server";
import { z } from "zod";
import { createRun } from "@/lib/run-store";
import { apiError } from "@/lib/api";

const inputSchema = z.object({
  linkedInUrl: z.string().min(1).max(2_000),
  nameHint: z.string().max(150).optional(),
  companyHint: z.string().max(150).optional(),
  allowManualUrl: z.boolean().optional(),
}).strict();

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_failed", message: "A LinkedIn profile URL and optional name/company hints are required." } },
      { status: 400 },
    );
  }
  try {
    const hints = parsed.data.nameHint || parsed.data.companyHint
      ? { name: parsed.data.nameHint, company: parsed.data.companyHint }
      : undefined;
    const run = await createRun(parsed.data.linkedInUrl, hints, { allowManualUrl: parsed.data.allowManualUrl });
    return NextResponse.json({ runId: run.id, stage: run.stage }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
