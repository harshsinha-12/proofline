import { describe, expect, it } from "vitest";
import fixture from "../fixtures/demo-run.json";
import { getDemoFixture, parseDemoFixture } from "@/lib/demo-fixture";
import { classifyClaim } from "@/pipeline/classify-claims";
import { getWriterInput, isEligibleClaim } from "@/lib/diagnostic-audit";
import { redactSecrets } from "@/lib/errors";

describe("golden demo fixture", () => {
  const data = getDemoFixture();

  it("loads the committed live ledger as a read-only demo run", () => {
    expect(parseDemoFixture(fixture)).not.toBeNull();
    expect(parseDemoFixture({ default: fixture })).not.toBeNull();
    expect(data?.run.id).toBe("demo");
    expect(data?.run.stage).toBe("awaiting_human_review");
    expect(data?.run.diagnostic).toBeUndefined();
  });

  it("keeps stored classifications aligned with the deterministic classifier", () => {
    expect(data).not.toBeNull();
    for (const claim of data!.claims) {
      expect(classifyClaim(claim, { sources: data!.sources, identityAmbiguous: data!.run.identityStatus !== "resolved" })).toMatchObject({
        status: claim.status,
        statusReason: claim.statusReason,
      });
    }
  });

  it("refuses the writer because this live run has no verified claims", () => {
    expect(data).not.toBeNull();
    expect(getWriterInput(data!.claims).status).toBe("insufficient_evidence");
    expect(data!.claims.filter(isEligibleClaim)).toHaveLength(0);
    expect(data!.claims.some((claim) => claim.containsNumber && ["rejected", "unverified", "partially_verified"].includes(claim.status))).toBe(true);
  });

  it("preserves fetch failures and does not embed secrets or raw HTML documents", () => {
    expect(data).not.toBeNull();
    expect(data!.sources.some((source) => source.fetchStatus === "timed_out")).toBe(true);
    expect(data!.sources.some((source) => source.fetchStatus === "blocked")).toBe(true);
    expect(redactSecrets(JSON.stringify(data))).toBe(JSON.stringify(data));
    expect(JSON.stringify(data)).not.toMatch(/<!DOCTYPE html/i);
    expect(data!.run.pipeline).toBeUndefined();
  });
});
