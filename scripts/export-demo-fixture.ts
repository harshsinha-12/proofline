import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDemoFixture } from "../src/lib/demo-fixture";
import { DEMO_RUN_ID } from "../src/lib/demo";
import { redactSecrets } from "../src/lib/errors";
import { sanitizeEventData } from "../src/lib/store-utils";
import { classifyClaim } from "../src/pipeline/classify-claims";
import { claimSchema } from "../src/schemas/claim";
import { sourceSchema } from "../src/schemas/source";
import { executionEventSchema, researchRunSchema } from "../src/schemas/run";

async function loadPayload(input: string) {
  if (/^https?:\/\//.test(input)) {
    const response = await fetch(input, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load run: HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  }
  return JSON.parse(await readFile(input, "utf8")) as unknown;
}

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("Pass a run JSON path or GET /api/research/:runId URL.");
  const raw = await loadPayload(input);
  if (!raw || typeof raw !== "object") throw new Error("Run payload is not an object.");
  const record = raw as Record<string, unknown>;
  const parsedRun = researchRunSchema.parse(record.run ?? raw);
  const sources = sourceSchema.array().parse(record.sources ?? []);
  const claims = claimSchema.array().parse(record.claims ?? []).map((claim) => ({
    ...claim,
    ...classifyClaim(claim, { sources, identityAmbiguous: parsedRun.identityStatus !== "resolved" }),
  }));
  const events = executionEventSchema.array().max(500).parse((Array.isArray(record.events) ? record.events : []).slice(-500)).map((event) => ({
    ...event,
    message: redactSecrets(event.message),
    data: sanitizeEventData(event.data),
  }));
  const { pipeline: _pipeline, ...rest } = parsedRun;
  const now = new Date().toISOString();
  const run = researchRunSchema.parse({
    ...rest,
    id: DEMO_RUN_ID,
    warnings: [
      ...rest.warnings,
      { code: "demo_export", message: "Sanitized live public-source ledger used as the read-only demo. No diagnostic was approved because no claim reached verified.", createdAt: now },
    ].slice(-50),
  });
  const payload = { run, sources, claims, events };
  if (!parseDemoFixture(payload)) throw new Error("parseDemoFixture rejected the exported payload.");
  const out = path.join(process.cwd(), "fixtures/demo-run.json");
  await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    out, stage: run.stage, sources: sources.length, claims: claims.length, events: events.length,
    verified: claims.filter((claim) => claim.status === "verified").length,
    fetched: sources.filter((source) => source.fetchStatus === "fetched").length,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
