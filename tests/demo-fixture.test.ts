import { describe, expect, it } from "vitest";
import fixture from "../fixtures/demo-run.json";
import { getDemoFixture, parseDemoFixture } from "@/lib/demo-fixture";
import { classifyClaim } from "@/pipeline/classify-claims";
import { getWriterInput, isEligibleClaim } from "@/lib/diagnostic-audit";
import { redactSecrets } from "@/lib/errors";

describe("golden demo fixture", () => {
  const data = getDemoFixture();

  it("loads the committed file as an approved read-only run", () => {
    expect(parseDemoFixture(fixture)).not.toBeNull();
    expect(parseDemoFixture({ default: fixture })).not.toBeNull();
    expect(data?.run.id).toBe("demo");
    expect(data?.run.diagnostic?.reviewStatus).toBe("approved");
    expect(data?.run.approvedBy).toBe("Harsh Sinha");
  });

  it("keeps stored classifications aligned with the deterministic classifier", () => {
    expect(data).not.toBeNull();
    for (const claim of data!.claims) {
      expect(classifyClaim(claim, { sources: data!.sources })).toMatchObject({
        status: claim.status,
        statusReason: claim.statusReason,
      });
    }
  });

  it("lets only verified approved facts reach the writer and keeps a quantitative refusal out", () => {
    expect(data).not.toBeNull();
    const input = getWriterInput(data!.claims);
    expect(input.status).toBe("ok");
    expect(input.facts).toHaveLength(3);
    expect(JSON.stringify(input.facts)).not.toContain("$6");
    expect(data!.claims.some((claim) => claim.containsNumber && claim.status === "partially_verified" && claim.humanDecision === "excluded")).toBe(true);
    expect(data!.claims.filter(isEligibleClaim).every((claim) => claim.status === "verified")).toBe(true);
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
