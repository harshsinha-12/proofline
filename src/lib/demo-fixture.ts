import fixture from "../../fixtures/demo-run.json";
import { z } from "zod";
import { researchRunSchema, executionEventSchema } from "@/schemas/run";
import { claimSchema } from "@/schemas/claim";
import { sourceSchema } from "@/schemas/source";
import { auditDiagnostic } from "@/lib/diagnostic-audit";
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

export function parseDemoFixture(value: unknown) {
  const parsed = demoFixtureSchema.safeParse(fixturePayload(value));
  if (!parsed.success || parsed.data.run.id !== DEMO_RUN_ID) return null;
  const data = parsed.data;
  if (redactSecrets(JSON.stringify(data)) !== JSON.stringify(data) || data.events.some((event) =>
    JSON.stringify(event.data) !== JSON.stringify(sanitizeEventData(event.data)))) return null;
  if (!data.run.diagnostic || data.run.diagnostic.reviewStatus !== "approved" ||
    !auditDiagnostic(data.run.diagnostic, data.claims.filter((claim) => claim.status === "verified" && claim.humanDecision === "approved")).valid) return null;
  return data;
}

export function getDemoFixture() {
  return parseDemoFixture(fixturePayload(fixture));
}
