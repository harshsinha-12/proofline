import { z } from "zod";
import { auditDiagnostic, auditWithRetry, isEligibleClaim, type WriterInput } from "@/lib/diagnostic-audit";
import { getClaims } from "@/lib/claim-store";
import { getDemoFixture } from "@/lib/demo-fixture";
import { AppError } from "@/lib/errors";
import { hashJson, shortHash } from "@/lib/hashing";
import { redisKey } from "@/lib/redis";
import { parseStored, withRedis } from "@/lib/store-utils";
import {
  MAX_RUN_EVENTS,
  appendEvent,
  commitRunCommands,
  loadRun,
  requirePersistedRun,
  runRetentionSeconds,
  runWriteCommands,
  saveRun,
  withRunLock,
} from "@/lib/run-store";
import { diagnosticSchema, type Diagnostic } from "@/schemas/diagnostic";
import { executionEventSchema, researchRunSchema } from "@/schemas/run";

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

export const approvedSnapshotSchema = z.object({
  diagnostic: diagnosticSchema,
  approvedAt: z.string().min(1),
  approvedBy: z.string().min(1),
  claimIds: z.array(z.string().min(1)),
  hash: z.string().min(1),
});

export type ApprovedSnapshot = z.infer<typeof approvedSnapshotSchema>;

export async function getApprovedSnapshot(runId: string): Promise<(ApprovedSnapshot & { fixtureMode: boolean }) | null> {
  const loaded = await loadRun(runId);
  if (!loaded) return null;
  if (loaded.fixtureMode) {
    const demo = getDemoFixture();
    const diagnostic = demo?.run.diagnostic;
    if (!diagnostic || diagnostic.reviewStatus !== "approved" || !demo.run.approvedAt || !demo.run.approvedBy) return null;
    return {
      diagnostic,
      approvedAt: demo.run.approvedAt,
      approvedBy: demo.run.approvedBy,
      claimIds: demo.claims.filter(isEligibleClaim).map((claim) => claim.id),
      hash: hashJson(diagnostic),
      fixtureMode: true,
    };
  }
  const raw = await withRedis(async (redis) => redis.get(redisKey("run", runId, "snapshot")));
  if (!raw) return null;
  return { ...parseStored(raw, approvedSnapshotSchema.parse), fixtureMode: false };
}

export async function approveDiagnostic(runId: string, confirmation: boolean, reviewerName: string) {
  if (confirmation !== true) throw new AppError("validation_failed", "Export approval requires explicit confirmation.", 400);
  const name = reviewerName.trim();
  if (!name || name.length > 120) throw new AppError("validation_failed", "A reviewer name is required.", 400);
  return withRunLock(runId, async (token) => {
    const run = await requirePersistedRun(runId);
    if (run.stage === "approved" || run.stage === "completed") {
      throw new AppError("approval_not_allowed", "This diagnostic is already approved for export.", 409);
    }
    if (run.stage !== "awaiting_human_review") {
      throw new AppError("approval_not_allowed", "The diagnostic is not awaiting export approval.", 409);
    }
    if (!run.diagnostic || run.diagnostic.reviewStatus !== "draft") {
      throw new AppError("approval_not_allowed", "Generate a draft from approved claims before export approval.", 409);
    }
    const claims = await getClaims(runId);
    const approvedClaims = claims.filter(isEligibleClaim);
    const diagnostic = diagnosticSchema.parse({ ...run.diagnostic, reviewStatus: "approved" });
    const audit = auditDiagnostic(diagnostic, approvedClaims);
    if (!audit.valid) throw new AppError("validation_failed", audit.issues.join(" "), 422);
    const now = new Date().toISOString();
    const snapshot: ApprovedSnapshot = {
      diagnostic,
      approvedAt: now,
      approvedBy: name,
      claimIds: approvedClaims.map((claim) => claim.id),
      hash: hashJson(diagnostic),
    };
    const updated = researchRunSchema.parse({
      ...run,
      stage: "approved",
      diagnostic,
      approvedAt: now,
      approvedBy: name,
      updatedAt: now,
    });
    const ttl = runRetentionSeconds(updated);
    const base = redisKey("run", runId);
    const event = executionEventSchema.parse({
      id: `evt_${shortHash(`${runId}:diagnostic-approved:${now}`)}`,
      at: now,
      stage: "approved",
      type: "diagnostic_approved",
      message: "An immutable approved snapshot was stored.",
      data: { stage: "approved" },
    });
    await commitRunCommands(runId, token, [
      ["SET", `${base}:snapshot`, JSON.stringify(snapshot), "EX", ttl],
      ["RPUSH", `${base}:events`, JSON.stringify(event)],
      ["LTRIM", `${base}:events`, -MAX_RUN_EVENTS, -1],
      ...await runWriteCommands(updated),
    ]);
    return { run: updated, snapshotHash: snapshot.hash };
  });
}
