import "server-only";
import { appendEvent, requirePersistedRun, saveRun, withRunLock } from "@/lib/run-store";
import { getClaims, saveClaim } from "@/lib/claim-store";
import { getSources, saveSource } from "@/lib/source-store";
import { eventId } from "@/lib/ids";
import { claimStatusCounts, progressFromLedgers } from "@/lib/research-progress";
import { stabilizeSourceKind } from "@/lib/source-kind";
import { applyClaimClassification } from "@/pipeline/classify-claims";

export async function reclassifyPersistedRun(runId: string) {
  return withRunLock(runId, async (token) => {
    const run = await requirePersistedRun(runId);
    const organization = run.subject?.organization;
    for (const source of await getSources(runId)) {
      const sourceKind = stabilizeSourceKind(source, organization);
      if (sourceKind !== source.sourceKind) await saveSource(runId, { ...source, sourceKind }, token);
    }
    const sources = await getSources(runId);
    const claims = await getClaims(runId);
    for (const claim of claims) {
      const next = applyClaimClassification(claim, { sources, identityAmbiguous: run.identityStatus !== "resolved" });
      if (next.status !== claim.status || next.statusReason !== claim.statusReason || next.containsNumber !== claim.containsNumber) {
        await saveClaim(runId, next, token);
      }
    }
    const savedClaims = await getClaims(runId);
    const savedSources = await getSources(runId);
    const current = await requirePersistedRun(runId);
    const updated = await saveRun({ ...current, progress: progressFromLedgers(savedClaims, savedSources) }, token);
    const counts = claimStatusCounts(savedClaims);
    await appendEvent(runId, {
      id: eventId(runId, (updated.pipeline?.eventSequence ?? 0) + 1),
      at: new Date().toISOString(),
      stage: updated.stage,
      type: "claims_reclassified",
      message: "Reclassified saved claims from the evidence ledger without repeating search or page fetches.",
      data: { count: savedClaims.length, stage: updated.stage },
    }, token);
    return { run: await requirePersistedRun(runId), claims: savedClaims, sources: savedSources, counts };
  });
}
