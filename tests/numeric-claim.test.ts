import { describe, expect, it } from "vitest";
import { extractNumbers, excerptContainsStatementNumbers, isInterfaceChrome, parseQuantities } from "@/lib/numbers";
import { classifyClaim } from "@/pipeline/classify-claims";
import { preservePageSourceKind, stabilizeSourceKind } from "@/lib/source-kind";
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
  it("treats compact, spelled-out, and expanded magnitudes as the same quantity", () => {
    expect(excerptContainsStatementNumbers("Stake funded AED 282 million.", "AED 282M+ value of properties funded")).toBe(true);
    expect(excerptContainsStatementNumbers("The round was 228 million.", "228,000,000")).toBe(true);
    expect(excerptContainsStatementNumbers("Headcount is 100K.", "100,000 people")).toBe(true);
    expect(excerptContainsStatementNumbers("Headcount is 100K.", "1,000 people")).toBe(false);
    expect(excerptContainsStatementNumbers("Revenue rose 6%.", "6 million")).toBe(false);
  });
  it("does not treat credential labels as quantitative claims", () => {
    expect(parseQuantities("Manar Mahmassani holds a CFA Level II certificate.")).toEqual([]);
    expect(parseQuantities("She holds CFA Level 2.")).toEqual([]);
    const credential = makeClaim({
      statement: "Manar Mahmassani holds a CFA Level II certificate.",
      containsNumber: true,
      check1: makeCheck(1, b, "Manar holds a CFA Level II certificate."),
      check2: makeCheck(2, b, "Manar holds a CFA Level II certificate."),
    });
    expect(classifyClaim(credential, { sources: [a, b].map((source) => ({ ...source, sourceKind: "reputable_secondary" as const })) }).status).toBe("unverified");
  });
  it("keeps first-party-only numbers partial when authority is useful but insufficient", () => {
    const company = makeSource("source_a", { textExcerpt: "AED 282M+ Value of properties funded", sourceKind: "company_first_party" });
    const numeric = makeClaim({
      statement: "Stake reports that the value of properties funded is more than AED 282 million.",
      containsNumber: true,
      check1: makeCheck(1, company, "Stake reports that the value of properties funded is more than AED 282 million.", { sourceAuthorityForClaim: "useful_but_insufficient" }),
    });
    expect(classifyClaim(numeric, { sources: [company] }).status).toBe("partially_verified");
  });
  it("rejects website job counters as interface chrome", () => {
    expect(isInterfaceChrome("Stake's leadership team has 0 jobs.")).toBe(true);
    const chrome = makeClaim({
      statement: "Stake's leadership team has 0 jobs.",
      containsNumber: true,
      check1: makeCheck(1, a, "Leadership Team2 people · 0 jobs"),
    });
    expect(classifyClaim(chrome, { sources: [a] }).status).toBe("rejected");
  });
});

describe("stable source kind", () => {
  it("does not let a later claim demote a company page", () => {
    expect(preservePageSourceKind("company_first_party", "other_secondary", "https://getstake-uat.com/about-us", "Stake")).toBe("company_first_party");
    expect(stabilizeSourceKind(makeSource("stake", { url: "https://getstake-uat.com/about-us", canonicalUrl: "https://getstake-uat.com/about-us", sourceKind: "other_secondary" }), "Stake")).toBe("company_first_party");
    expect(stabilizeSourceKind(makeSource("help", { url: "https://help.getstake.com/en", canonicalUrl: "https://help.getstake.com/en", sourceKind: "unknown" }), "Stake")).toBe("company_first_party");
    expect(stabilizeSourceKind(makeSource("other", { url: "https://onstak.com/company", canonicalUrl: "https://onstak.com/company", sourceKind: "unknown" }), "Stake")).toBe("unknown");
    expect(stabilizeSourceKind(makeSource("tld", { url: "https://company.example/about", canonicalUrl: "https://company.example/about", sourceKind: "institutional_first_party" }), "Example")).toBe("institutional_first_party");
  });
});
