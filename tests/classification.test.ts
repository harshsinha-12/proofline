import { describe, expect, it } from "vitest";
import { classifyClaim } from "@/pipeline/classify-claims";
import { makeClaim, makeCheck, makeSource } from "./helpers/fixtures";

describe("deterministic classification", () => {
  const a = makeSource();
  const b = makeSource("source_b");
  const claim = makeClaim({ check1: makeCheck(1, a), check2: makeCheck(2, b) });
  it("verifies two independent exact supports with qualifying primary evidence", () => {
    expect(classifyClaim(claim, { sources: [a, b] }).status).toBe("verified");
  });
  it("rejects a contradicted material claim", () => {
    const contradicted = makeClaim({ materiality: "high", check1: makeCheck(1, a, claim.statement, { verdict: "contradicted" }) });
    expect(classifyClaim(contradicted, { sources: [a] }).status).toBe("rejected");
  });
  it("keeps credible unresolved disagreement in conflict", () => {
    expect(classifyClaim({ ...claim, check2: { ...claim.check2!, verdict: "contradicted" } }, { sources: [a, b] }).status).toBe("conflict");
  });
  it("resolves clearly dated stale secondary disagreement with a newer regulator record conservatively", () => {
    const official = { ...a, sourceKind: "regulator_or_government" as const, publishedAt: "2026-09-01" };
    const old = { ...b, sourceKind: "reputable_secondary" as const, publishedAt: "2024-01-01" };
    const result = classifyClaim({ ...claim, check2: { ...claim.check2!, verdict: "contradicted" } }, { sources: [official, old] });
    expect(result.status).toBe("partially_verified");
    expect(result.statusReason).toContain("newer official record");
  });
  it("does not resolve disagreement using invalid publication dates", () => {
    expect(classifyClaim({ ...claim, check2: { ...claim.check2!, verdict: "contradicted" } }, {
      sources: [{ ...a, sourceKind: "regulator_or_government", publishedAt: "bad" }, { ...b, publishedAt: "2024-01-01" }],
    }).status).toBe("conflict");
  });
  it.each(["identityAmbiguous", "wordingOverstates", "opinionMergedWithFact", "inventedDetail"] as const)("blocks %s", (flag) => {
    expect(classifyClaim(claim, { sources: [a, b], [flag]: true }).status).not.toBe("verified");
  });
  it("requires exact scope and refuses unresolved limitations", () => {
    expect(classifyClaim({ ...claim, check2: { ...claim.check2!, limitations: ["Role date is unclear."] } }, { sources: [a, b] }).status).toBe("partially_verified");
    expect(classifyClaim({ ...claim, check2: { ...claim.check2!, evidence: [{ ...claim.check2!.evidence[0], supportsExactly: "Alex worked at Example." }] } }, { sources: [a, b] }).status).toBe("partially_verified");
  });
  it("requires an explicit as-of date in time-sensitive wording", () => {
    expect(classifyClaim({ ...claim, timeSensitive: true }, { sources: [a, b] }).status).toBe("partially_verified");
    expect(classifyClaim({ ...claim, timeSensitive: true, asOfDate: "2026-09-12" }, { sources: [a, b] }).status).toBe("partially_verified");
  });
  it("does not trust an inaccessible source or an invented evidence excerpt", () => {
    expect(classifyClaim(claim, { sources: [{ ...a, fetchStatus: "blocked" }, { ...b, fetchStatus: "blocked" }] }).status).toBe("unverified");
    expect(classifyClaim(claim, { sources: [{ ...a, textExcerpt: "Unrelated." }, { ...b, textExcerpt: "Unrelated." }] }).status).toBe("unverified");
  });
  it("secondary-only support remains unverified", () => {
    expect(classifyClaim(claim, { sources: [a, b].map((source) => ({ ...source, sourceKind: "reputable_secondary" })) }).status).toBe("unverified");
  });
  it("reports source-budget exhaustion separately from missing evidence", () => {
    const empty = makeClaim({
      check1: makeCheck(1, a, claim.statement, { verdict: "no_evidence", sourceAuthorityForClaim: "not_qualifying", evidence: [], limitations: ["No accessible replacement source established an independent second check within the source budget."] }),
    });
    expect(classifyClaim(empty, { sources: [a] }).statusReason).toContain("Source budget exhausted");
  });
  it("a missing second check remains partial and a missing evidence set remains unverified", () => {
    expect(classifyClaim({ ...claim, check2: undefined }, { sources: [a, b] }).status).toBe("partially_verified");
    expect(classifyClaim(makeClaim(), { sources: [a, b] }).status).toBe("unverified");
  });
  it("does not verify a second check whose evidence is not qualifying", () => {
    expect(classifyClaim({ ...claim, check2: { ...claim.check2!, sourceAuthorityForClaim: "not_qualifying" } }, { sources: [a, b] }).status).toBe("partially_verified");
  });
  it("validates a literal as-of date against the checked dates", () => {
    const statement = "Alex leads Example as of 2026-09-12.";
    const currentA = { ...a, textExcerpt: statement }; const currentB = { ...b, textExcerpt: statement };
    const current = makeClaim({ statement, timeSensitive: true, asOfDate: "2026-09-12", check1: makeCheck(1, currentA, statement), check2: makeCheck(2, currentB, statement) });
    expect(classifyClaim(current, { sources: [currentA, currentB] }).status).toBe("verified");
    expect(classifyClaim({ ...current, asOfDate: "2026-02-30" }, { sources: [currentA, currentB] }).status).toBe("partially_verified");
  });
});
