import { auditWithRetry, type WriterInput } from "@/lib/diagnostic-audit";
import { getClaims } from "@/lib/claim-store";
import { AppError } from "@/lib/errors";
import { shortHash } from "@/lib/hashing";
import { appendEvent, requirePersistedRun, saveRun, withRunLock } from "@/lib/run-store";

/** Provider-independent boundary: audit before persisting, and retain every failed attempt. */
export async function generateAuditedDraft(
  runId: string,
  generate: (input: Extract<WriterInput, { status: "ok" }>, previousIssues: string[]) => Promise<unknown>,
  roleLimitation?: string,
  lockToken?: string,
) {
  return withRunLock(runId, async (token) => {
    const run = await requirePersistedRun(runId);
    if (run.stage !== "awaiting_human_review") throw new AppError("approval_not_allowed", "Diagnostic drafting requires the human-review stage.", 409);
    const claims = await getClaims(runId);
    const result = await auditWithRetry(claims, generate, async (audit, attempt) => {
      const at = new Date().toISOString();
      await appendEvent(runId, {
        id: `evt_${shortHash(`${runId}:diagnostic-audit:${at}:${attempt}`)}`, at, stage: run.stage,
        type: "diagnostic_audit_failed", message: "Diagnostic output failed the integrity audit.", data: { issues: audit.issues, attempt },
      }, token);
    }, roleLimitation);
    if (result.status === "ok") {
      const current = await requirePersistedRun(runId);
      const diagnostic = { ...result.diagnostic, reviewStatus: "draft" as const };
      await saveRun({ ...current, diagnostic }, token);
      return { status: "ok" as const, diagnostic };
    }
    return result;
  }, lockToken);
}
