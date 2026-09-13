import "server-only";
import { isDeepStrictEqual } from "node:util";
import { getClaims } from "@/lib/claim-store";
import { generateAuditedDraft } from "@/lib/diagnostic-store";
import { MAX_DIAGNOSTIC_CHARACTERS, MAX_DIAGNOSTIC_WORDS } from "@/lib/diagnostic-audit";
import { requirePersistedRun, saveRun } from "@/lib/run-store";
import { AppError } from "@/lib/errors";
import { analyzeGaps } from "@/pipeline/analyze-gaps";
import type { PipelineContext } from "@/pipeline/shared";
import * as prompt from "@/prompts/diagnostic-writer";

/** Called by the review flow after claim approval; research never approves facts itself. */
export async function draftDiagnostic(context: PipelineContext, roleLimitation?: string) {
  if (context.run.stage !== "awaiting_human_review") throw new AppError("approval_not_allowed", "Drafting requires human review.", 409);
  const analysis = await analyzeGaps(context, roleLimitation);
  if (analysis.status !== "ok") return analysis;
  const claims = await getClaims(context.run.id);
  const count = (status: string) => claims.filter((claim) => claim.status === status).length;
  const generatedAt = new Date().toISOString();
  const integritySummary = { evaluated: claims.length, verified: count("verified"), partiallyVerified: count("partially_verified"),
    unverified: count("unverified"), rejected: count("rejected"), conflicts: count("conflict") };
  await saveRun({ ...await requirePersistedRun(context.run.id), gaps: analysis.gaps }, context.token);
  try {
    return await generateAuditedDraft(context.run.id, async (input, previousIssues) => {
      const result = await context.services.requestStructured(prompt, {
        currentDate: generatedAt.slice(0, 10), generatedAt, integritySummary,
        facts: input.facts.map((fact) => ({ ...fact, asOfDate: fact.asOfDate ?? null })),
        gaps: analysis.gaps, roleLimitation: input.roleLimitation ?? null,
        maxWords: MAX_DIAGNOSTIC_WORDS, maxCharacters: MAX_DIAGNOSTIC_CHARACTERS, previousIssues,
      }, context);
      if (result.status === "insufficient_evidence") throw new AppError("insufficient_evidence", "The approved facts cannot support a diagnostic.", 422);
      const diagnostic = result.diagnostic;
      if (!diagnostic || diagnostic.generatedAt !== generatedAt || diagnostic.reviewStatus !== "draft" ||
        !isDeepStrictEqual(diagnostic.integritySummary, integritySummary) || diagnostic.credibilitySignals.length !== 3 ||
        !isDeepStrictEqual(diagnostic.gaps, analysis.gaps)) return null;
      return diagnostic;
    }, roleLimitation, context.token);
  } catch (error) {
    if (error instanceof AppError && error.code === "insufficient_evidence") return { status: "insufficient_evidence" as const, facts: [], reason: error.message };
    throw error;
  }
}
