import { describe, expect, it, vi } from "vitest";
import { auditDiagnostic, auditWithRetry } from "@/lib/diagnostic-audit";
import { makeDiagnostic, makeClaim, verifiedClaims } from "./helpers/fixtures";

describe("diagnostic output audit", () => {
  it("accepts complete evidence-bounded prose and excludes metadata counts and dates from numeric checks", () => {
    expect(auditDiagnostic(makeDiagnostic(), verifiedClaims())).toEqual({ valid: true, issues: [] });
  });
  it("blocks unknown top-level and inline citations", () => {
    expect(auditDiagnostic(makeDiagnostic({ citationClaimIds: ["unknown"] }), verifiedClaims()).valid).toBe(false);
    expect(auditDiagnostic(makeDiagnostic({ credibilitySignals: [{ text: "Alex leads Example.", claimIds: ["unknown"] }] }), verifiedClaims()).valid).toBe(false);
  });
  it.each(["A $6B career.", "A 2025 founding.", "A 2020% increase."])("blocks new numeric detail: %s", (text) => {
    expect(auditDiagnostic(makeDiagnostic({ narrativeOpportunity: text }), verifiedClaims()).valid).toBe(false);
  });
  it("requires numeric attribution to the signal's cited claims", () => {
    expect(auditDiagnostic(makeDiagnostic({ credibilitySignals: [{ text: "Founded in 2020.", claimIds: ["identity"] }] }), verifiedClaims()).valid).toBe(false);
  });
  it.each([2, 4])("blocks %s gaps", (count) => {
    const diagnostic = makeDiagnostic();
    expect(auditDiagnostic({ ...diagnostic, gaps: Array.from({ length: count }, () => diagnostic.gaps[0]) }, verifiedClaims()).valid).toBe(false);
  });
  it.each(["Alex — leader", "Alex #founder"])("blocks forbidden copy: %s", (text) => {
    expect(auditDiagnostic(makeDiagnostic({ currentPositioning: text }), verifiedClaims()).valid).toBe(false);
  });
  it("blocks long output and banned writer inputs", () => {
    expect(auditDiagnostic(makeDiagnostic({ narrativeOpportunity: "word ".repeat(651) }), verifiedClaims()).valid).toBe(false);
    expect(auditDiagnostic(makeDiagnostic(), [...verifiedClaims(), makeClaim({ status: "rejected" })]).valid).toBe(false);
  });
  it("returns insufficient evidence before invoking a generator", async () => {
    const generate = vi.fn();
    expect((await auditWithRetry([], generate, vi.fn())).status).toBe("insufficient_evidence");
    expect(generate).not.toHaveBeenCalled();
  });
  it("records failed output, retries once, and does not silently repair it", async () => {
    const invalid = makeDiagnostic({ currentPositioning: "Alex #founder" });
    const generate = vi.fn().mockResolvedValueOnce(invalid).mockResolvedValueOnce(makeDiagnostic());
    const record = vi.fn();
    expect((await auditWithRetry(verifiedClaims(), generate, record)).status).toBe("ok");
    expect(record).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(invalid.currentPositioning).toBe("Alex #founder");
  });
  it("retains both failures and throws a typed error after the single retry", async () => {
    const generate = vi.fn().mockResolvedValue(makeDiagnostic({ currentPositioning: "Alex #founder" }));
    const record = vi.fn();
    await expect(auditWithRetry(verifiedClaims(), generate, record)).rejects.toMatchObject({ code: "validation_failed", status: 422 });
    expect(record).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
