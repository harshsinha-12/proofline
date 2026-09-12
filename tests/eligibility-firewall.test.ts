import { describe, expect, it } from "vitest";
import { approveAllEligible, getWriterInput, reviewClaim } from "@/lib/diagnostic-audit";
import { makeClaim, verifiedClaims } from "./helpers/fixtures";

describe("eligibility firewall", () => {
  it("projects only verified human-approved facts and strips evidence and raw extras", () => {
    const claims = verifiedClaims();
    const rejected = { ...makeClaim({ statement: "BANNED detail", status: "rejected", humanDecision: "approved" }), rawPage: "RAW PAGE" };
    const input = getWriterInput([...claims, rejected]);
    expect(input.status).toBe("ok");
    expect(input.facts).toHaveLength(3);
    expect(JSON.stringify(input)).not.toMatch(/BANNED|RAW PAGE|check1|originSourceIds/);
  });
  it.each(["pending", "partially_verified", "unverified", "rejected", "conflict"] as const)("rejects approval of %s", (status) => {
    expect(() => reviewClaim(makeClaim({ status }), "approved")).toThrow("Only verified");
  });
  it("bulk approval leaves every banned status untouched", () => {
    const partial = makeClaim({ status: "partially_verified" });
    const result = approveAllEligible([...verifiedClaims().map((claim) => ({ ...claim, humanDecision: "pending" as const })), partial]);
    expect(result.slice(0, 3).every((claim) => claim.humanDecision === "approved")).toBe(true);
    expect(result[3]).toEqual(partial);
  });
  it("requires a viable identity and role set and stops on identity conflicts", () => {
    expect(getWriterInput(verifiedClaims().slice(0, 2)).status).toBe("insufficient_evidence");
    expect(getWriterInput([...verifiedClaims(), makeClaim({ category: "identity", status: "conflict" })]).status).toBe("insufficient_evidence");
    const claims = verifiedClaims().map((claim) => claim.category === "role" ? { ...claim, category: "career" as const } : claim);
    expect(getWriterInput(claims).status).toBe("insufficient_evidence");
    expect(getWriterInput(claims, "A current role could not be established.").status).toBe("ok");
  });
});
