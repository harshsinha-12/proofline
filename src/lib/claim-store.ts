import { redisKey } from "@/lib/redis";
import { getDemoFixture } from "@/lib/demo-fixture";
import { AppError } from "@/lib/errors";
import { hashJson } from "@/lib/hashing";
import { invalidateDiagnosticApproval, reviewClaim } from "@/lib/diagnostic-audit";
import { parseStored, withRedis } from "@/lib/store-utils";
import { commitRunCommands, loadRun, requirePersistedRun, runRetentionSeconds, runWriteCommands, withRunLock } from "@/lib/run-store";
import { claimSchema, type Claim, type HumanDecision } from "@/schemas/claim";

export async function saveClaim(runId: string, claim: Claim, lockToken?: string): Promise<Claim> {
  let parsed = claimSchema.parse(claim);
  if (parsed.humanDecision === "approved" && parsed.status !== "verified") throw new AppError("approval_not_allowed", "Only verified claims can be approved.", 409);
  return withRunLock(runId, async (token) => {
    const run = await requirePersistedRun(runId);
    const base = redisKey("run", runId);
    const previous = await withRedis(async (redis) => {
      const value = await redis.get(`${base}:claim:${parsed.id}`);
      return value ? parseStored(value, claimSchema.parse) : null;
    });
    if (previous) {
      const evidenceFields = (value: Claim) => ({ statement: value.statement, subjectId: value.subjectId, category: value.category, materiality: value.materiality,
        containsNumber: value.containsNumber, timeSensitive: value.timeSensitive, asOfDate: value.asOfDate ?? null,
        originSourceIds: value.originSourceIds, check1: value.check1 ?? null, check2: value.check2 ?? null, status: value.status, statusReason: value.statusReason });
      if (hashJson(evidenceFields(previous)) !== hashJson(evidenceFields(parsed))) parsed = { ...parsed, humanDecision: "pending" };
      if (hashJson(previous) === hashJson(parsed)) return previous;
    }
    const updated = { ...invalidateDiagnosticApproval(run), updatedAt: new Date().toISOString() };
    const ttl = runRetentionSeconds(updated);
    await commitRunCommands(runId, token, [["SET", `${base}:claim:${parsed.id}`, JSON.stringify(parsed), "EX", ttl],
      ["SADD", `${base}:claims`, parsed.id], ["EXPIRE", `${base}:claims`, ttl], ["DEL", `${base}:snapshot`], ...await runWriteCommands(updated)]);
    return parsed;
  }, lockToken);
}

export async function getClaims(runId: string): Promise<Claim[]> {
  const loaded = await loadRun(runId);
  if (!loaded) return [];
  if (loaded.fixtureMode) return getDemoFixture()!.claims;
  return withRedis(async (redis) => {
    const base = redisKey("run", runId);
    const ids = (await redis.smembers(`${base}:claims`)).sort();
    if (!ids.length) return [];
    const values = await redis.mget(...ids.map((id) => `${base}:claim:${id}`));
    if (values.some((value) => value === null)) throw new AppError("validation_failed", "The claim ledger contains a missing indexed claim.", 500);
    return values.filter((value): value is string => value !== null).map((value) => parseStored(value, claimSchema.parse));
  });
}

export async function getClaim(runId: string, claimId: string): Promise<Claim | null> {
  return (await getClaims(runId)).find((claim) => claim.id === claimId) ?? null;
}

export async function updateClaimReview(runId: string, claimId: string, decision: HumanDecision, note?: string, lockToken?: string): Promise<Claim> {
  return withRunLock(runId, async (token) => {
    await requirePersistedRun(runId);
    const claim = await getClaim(runId, claimId);
    if (!claim) throw new AppError("not_found", "Claim not found.", 404);
    return saveClaim(runId, reviewClaim(claim, decision, note), token);
  }, lockToken);
}

export async function approveAllVerifiedClaims(runId: string): Promise<Claim[]> {
  return withRunLock(runId, async (token) => {
    await requirePersistedRun(runId);
    const claims = await getClaims(runId);
    const result: Claim[] = [];
    for (const claim of claims) result.push(claim.status === "verified" ? await saveClaim(runId, reviewClaim(claim, "approved"), token) : claim);
    return result;
  });
}
