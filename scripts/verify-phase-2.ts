import { loadEnvConfig } from "@next/env";
import Redis from "ioredis";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { createRun, getRun, getEvents } from "../src/lib/run-store";
import { getClaims, updateClaimReview } from "../src/lib/claim-store";
import { getSources } from "../src/lib/source-store";
import { getWriterInput } from "../src/lib/diagnostic-audit";
import { getRedis, pingRedis } from "../src/lib/redis";
import { AppError, toClientError } from "../src/lib/errors";
import { advanceRun } from "../src/pipeline/advance-run";

loadEnvConfig(process.cwd());
process.env.REDIS_KEY_PREFIX = process.env.VERIFICATION_REDIS_PREFIX ?? `proofline:verification:${Date.now()}`;
process.env.MAX_CLAIMS_PER_RUN = "1";
process.env.MAX_SOURCES_PER_RUN = "8";
if (process.env.REDIS_TEST_SOCKET) {
  (globalThis as unknown as { prooflineRedis?: Redis }).prooflineRedis = new Redis(process.env.REDIS_TEST_SOCKET, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
}

async function main() {
  const linkedInUrl = process.argv[2];
  if (!linkedInUrl) throw new Error("Pass the public LinkedIn profile URL to verify.");
  try { await pingRedis(); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    const reason = /wrongpass|authentication|noauth/i.test(message) ? "Redis authentication failed." :
      /certificate|ssl|tls|wrong version/i.test(message) ? "Redis TLS handshake failed." :
      /ENOTFOUND|getaddrinfo/i.test(message) ? "Redis host could not resolve." : "Configured Redis could not be reached.";
    throw new AppError("redis_unavailable", reason, 503);
  }
  const run = process.env.VERIFICATION_RUN_ID ? await getRun(process.env.VERIFICATION_RUN_ID) : await createRun(linkedInUrl, { name: process.argv[3], company: process.argv[4] });
  if (!run) throw new AppError("not_found", "Verification run was not found.", 404);
  const started = Date.now();
  console.log(JSON.stringify({ type: "started", runId: run.id, redisPrefix: process.env.REDIS_KEY_PREFIX }));
  for (let index = 0; index < 120 && Date.now() - started < 480_000; index++) {
    let result;
    try { result = await advanceRun(run.id); }
    catch (error) {
      if (!(error instanceof AppError) || error.code !== "lock_held") throw error;
      console.log(JSON.stringify({ type: "waiting", reason: "The previous worker lock has not expired yet." }));
      await delay(5_000);
      continue;
    }
    console.log(JSON.stringify({ type: "checkpoint", index, stage: result.stage, progress: result.progress, canContinue: result.canContinue, warnings: result.warnings.slice(-1) }));
    if (!result.canContinue) {
      if (result.retryAfter && result.stage !== "failed" && result.warnings.at(-1)?.code !== "invalid_env") {
        await delay(Math.min(10_100, Math.max(0, Date.parse(result.retryAfter) - Date.now()) + 100));
        continue;
      }
      break;
    }
  }
  const claims = await getClaims(run.id);
  const eligible = claims.find((claim) => claim.status === "verified");
  if (eligible) await updateClaimReview(run.id, eligible.id, "approved", "Local vertical-slice verification only; no client-ready diagnostic approved.");
  const report = { checkedAt: new Date().toISOString(), run: await getRun(run.id), sources: await getSources(run.id), claims: await getClaims(run.id),
    events: await getEvents(run.id), writerInput: getWriterInput(await getClaims(run.id)) };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/phase-2-vertical-slice.json", JSON.stringify(report, null, 2));
  if (!claims.some((claim) => claim.check1 && claim.check2) || report.run?.stage !== "awaiting_human_review") {
    console.log(JSON.stringify({ type: "incomplete", reason: "Live research did not complete both checks. Inspect the saved evidence report." }));
    process.exitCode = 1;
  } else console.log(JSON.stringify({ type: "completed", status: claims[0].status, writerStatus: report.writerInput.status }));
}

main().catch((error) => { console.log(JSON.stringify({ type: "error", ...toClientError(error) })); process.exitCode = 1; })
  .finally(() => getRedis().disconnect());
