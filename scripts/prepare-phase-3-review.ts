import { loadEnvConfig } from "@next/env";
import { writeFile } from "node:fs/promises";
import { createRun, getEvents, getRun, saveRun } from "../src/lib/run-store";
import { saveSource, getSources } from "../src/lib/source-store";
import { getClaims, saveClaim } from "../src/lib/claim-store";
import { getApprovedSnapshot } from "../src/lib/diagnostic-store";
import { getRedis } from "../src/lib/redis";
import { classifyClaim } from "../src/pipeline/classify-claims";
import { hashContent } from "../src/lib/hashing";
import { makeClaim, makeSource, makeCheck } from "../tests/helpers/fixtures";

loadEnvConfig(process.cwd());

async function main() {
  if (process.argv[2]) {
    const runId = process.argv[2];
    const report = { syntheticQA: true, checkedAt: new Date().toISOString(), run: await getRun(runId), sources: await getSources(runId),
      claims: await getClaims(runId), events: await getEvents(runId), snapshot: await getApprovedSnapshot(runId) };
    await writeFile("artifacts/phase-3-review.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ runId, stage: report.run?.stage, approved: !!report.snapshot, events: report.events.length }));
    return;
  }
  const run = await createRun("https://www.linkedin.com/in/proofline-synthetic-review");
  const statements = ["Alex Example is a fictional subject for this synthetic QA check.", "Alex Example is the fictional CEO of Example Company.", "Fictional Example Company was founded in 2020."];
  const sources = [makeSource("qa_primary", { sourceKind: "company_first_party", textExcerpt: `Synthetic company record. ${statements.join(" ")}` }),
    makeSource("qa_independent", { sourceKind: "institutional_first_party", textExcerpt: `Synthetic independent record. ${statements.join(" ")}` })]
    .map((source) => ({ ...source, contentHash: hashContent(source.textExcerpt!), notes: ["Synthetic QA evidence only. These are not real public facts."] }));
  for (const source of sources) await saveSource(run.id, source);
  for (const [index, statement] of statements.entries()) {
    const claim = makeClaim({ id: `qa_claim_${index}`, statement, category: (["identity", "role", "company"] as const)[index], containsNumber: index === 2,
      originSourceIds: [sources[0].id], check1: makeCheck(1, sources[0], statement), check2: makeCheck(2, sources[1], statement) });
    await saveClaim(run.id, { ...claim, ...classifyClaim(claim, { sources }) });
  }
  const now = new Date().toISOString();
  await saveRun({ ...run, stage: "awaiting_human_review", identityStatus: "resolved",
    subject: { fullName: "Synthetic QA: Alex Example", currentRole: "Fictional CEO", organization: "Example Company", canonicalLinkedInUrl: run.linkedInUrl, aliases: [], identityEvidence: [], ambiguityNotes: ["Fictional QA subject."] },
    progress: { sourcesDiscovered: 2, sourcesFetched: 2, claimsExtracted: 3, checksCompleted: 6, verifiedClaims: 3, excludedClaims: 0 },
    warnings: [{ code: "synthetic_qa", message: "Synthetic QA case only. No real subject or public facts are represented.", createdAt: now }] });
  console.log(JSON.stringify({ runId: run.id, url: `http://127.0.0.1:3000/research/${run.id}`, syntheticQA: true }));
}

main().catch(() => { console.error("Synthetic review verification failed; no credentials are logged."); process.exitCode = 1; }).finally(() => getRedis().disconnect());
