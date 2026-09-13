import fixture from "../../fixtures/demo-run.json";
import { z } from "zod";
import { researchRunSchema, executionEventSchema } from "@/schemas/run";
import { claimSchema } from "@/schemas/claim";
import { sourceSchema } from "@/schemas/source";
import { auditDiagnostic, isEligibleClaim } from "@/lib/diagnostic-audit";
import { redactSecrets } from "@/lib/errors";
import { sanitizeEventData } from "@/lib/store-utils";
import { DEMO_RUN_ID } from "@/lib/demo";

export { DEMO_RUN_ID, DEMO_LINKEDIN_URL, DEMO_NAME_HINT, DEMO_COMPANY_HINT } from "@/lib/demo";

const demoFixtureSchema = z.object({
  run: researchRunSchema,
  sources: z.array(sourceSchema),
  claims: z.array(claimSchema),
  events: z.array(executionEventSchema).max(500),
});

function fixturePayload(value: unknown): unknown {
  if (value && typeof value === "object" && "run" in value) return value;
  if (value && typeof value === "object" && "default" in value) return fixturePayload((value as { default: unknown }).default);
  return value;
}

function isReviewLedger(data: z.infer<typeof demoFixtureSchema>) {
  return ["awaiting_human_review", "failed"].includes(data.run.stage) && data.claims.length > 0 && data.sources.length > 0;
}

export function parseDemoFixture(value: unknown) {
  const parsed = demoFixtureSchema.safeParse(fixturePayload(value));
  if (!parsed.success || parsed.data.run.id !== DEMO_RUN_ID) return null;
  const data = parsed.data;
  if (redactSecrets(JSON.stringify(data)) !== JSON.stringify(data) || data.events.some((event) =>
    JSON.stringify(event.data) !== JSON.stringify(sanitizeEventData(event.data)))) return null;
  const eligible = data.claims.filter(isEligibleClaim);
  if (data.run.diagnostic?.reviewStatus === "approved") {
    if (!data.run.approvedAt || !data.run.approvedBy || !auditDiagnostic(data.run.diagnostic, eligible).valid) return null;
    return data;
  }
  if (!isReviewLedger(data)) return null;
  return data;
}

export function getDemoFixture() {
  return parseDemoFixture(fixturePayload(fixture));
}
