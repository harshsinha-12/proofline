import { describe, expect, it } from "vitest";
import { extractNumbers } from "@/lib/numbers";
import { classifyClaim } from "@/pipeline/classify-claims";
import { makeSource, makeClaim, makeCheck } from "./helpers/fixtures";

describe("numeric attribution", () => {
  const statement = "Alex executed $6B in transactions.";
  const a = makeSource("source_a", { textExcerpt: statement, sourceKind: "subject_first_party" });
  const b = makeSource("source_b", { textExcerpt: statement, sourceKind: "reputable_secondary", suspectedOriginId: a.id });
  const claim = makeClaim({ statement, containsNumber: true, category: "performance", materiality: "high", check1: makeCheck(1, a, statement), check2: makeCheck(2, b, statement) });
  it("first-party performance numbers plus repeated secondary coverage stay partial", () => {
    expect(classifyClaim(claim, { sources: [a, b] }).status).toBe("partially_verified");
  });
  it("requires a qualifying numeric excerpt even when the numeric flag is false", () => {
    expect(classifyClaim({ ...claim, containsNumber: false }, { sources: [a, b].map((source) => ({ ...source, sourceKind: "reputable_secondary" })) }).status).toBe("rejected");
  });
  it("can verify an independently confirmed qualifying number", () => {
    const official = { ...b, sourceKind: "regulator_or_government" as const, suspectedOriginId: undefined };
    expect(classifyClaim(claim, { sources: [a, official] }).status).toBe("verified");
  });
  it("does not confuse magnitudes, percentages, or currencies", () => {
    expect(extractNumbers("$6B, $6M, 6%, 6, €6 and 1,000 transactions")).toEqual(["$6b", "$6m", "6%", "6", "€6", "1000"]);
    expect(extractNumbers("6 billion and 12 months")).toEqual(["6b", "12"]);
  });
});
