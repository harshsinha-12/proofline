import { describe, expect, it } from "vitest";
import { checksShareOrigin, classifyClaim } from "@/pipeline/classify-claims";
import { makeSource, makeClaim, makeCheck } from "./helpers/fixtures";

describe("source independence", () => {
  it.each(["contentHash", "suspectedOriginId", "canonicalUrl"] as const)("blocks shared %s", (field) => {
    const a = makeSource("source_a", { [field]: "shared_origin" });
    const b = makeSource("source_b", { [field]: "shared_origin" });
    const claim = makeClaim({ check1: makeCheck(1, a), check2: makeCheck(2, b) });
    expect(checksShareOrigin(claim.check1!, claim.check2!, [a, b])).toBe(true);
    expect(classifyClaim(claim, { sources: [a, b] }).status).toBe("partially_verified");
  });
  it("blocks two uses of the same source even if marked independent", () => {
    const a = makeSource();
    expect(classifyClaim(makeClaim({ check1: makeCheck(1, a), check2: makeCheck(2, a) }), { sources: [a] }).status).not.toBe("verified");
  });
  it.each(["unknown", "possibly_derived", "same_origin"] as const)("blocks %s independence", (independence) => {
    const a = makeSource(); const b = makeSource("source_b");
    const claim = makeClaim({ check1: makeCheck(1, a), check2: makeCheck(2, b, undefined, { independenceFromOtherCheck: independence }) });
    expect(classifyClaim(claim, { sources: [a, b] }).status).toBe("partially_verified");
  });
  it("recognizes a secondary copy pointing at its primary origin", () => {
    const a = makeSource(); const b = makeSource("source_b", { suspectedOriginId: a.id });
    expect(checksShareOrigin(makeCheck(1, a), makeCheck(2, b), [a, b])).toBe(true);
  });
});
