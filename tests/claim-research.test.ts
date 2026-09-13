import { describe, expect, it } from "vitest";
import { prioritizeClaims, singleSourceEvidence, targetedQuery } from "@/lib/claim-research";
import { makeClaim, makeCheck, makeSource } from "./helpers/fixtures";

describe("targeted claim research", () => {
  it("prioritizes identity and current role ahead of optional credentials", () => {
    const career = makeClaim({ id: "a", category: "career", materiality: "medium" });
    const role = makeClaim({ id: "z", category: "role" });
    const identity = makeClaim({ id: "y", category: "identity" });
    expect(prioritizeClaims([career, role, identity]).map((claim) => claim.id)).toEqual(["y", "z", "a"]);
    expect(targetedQuery({ ...career, statement: "Alex holds a CFA Level II certificate." }, "Alex Example")).toContain('"CFA" qualification education official employer biography');
  });
  it("offers source attribution without changing verification status or approval eligibility", () => {
    const source = makeSource();
    const claim = makeClaim({ status: "unverified", check1: makeCheck(1, source), check2: makeCheck(2, source, undefined, { verdict: "no_evidence", evidence: [] }) });
    expect(singleSourceEvidence(claim)?.excerpt).toBe(source.textExcerpt);
    expect(claim.status).toBe("unverified");
    expect(singleSourceEvidence({ ...claim, status: "conflict" })).toBeUndefined();
    expect(singleSourceEvidence({ ...claim, check1: undefined })).toBeUndefined();
  });
});
