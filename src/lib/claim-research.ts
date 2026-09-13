import type { Claim } from "@/schemas/claim";

export function prioritizeClaims(claims: Claim[]): Claim[] {
  const rank = (claim: Claim) => claim.category === "identity" ? 0 : claim.category === "role" ? 1 : claim.category === "company" ? 2 : claim.materiality === "high" ? 3 : claim.category === "career" ? 5 : 4;
  return [...claims].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

export function targetedQuery(claim: Claim, name: string, organization?: string): string {
  const subject = `"${name.replace(/"/g, "")}"`;
  const credential = claim.statement.match(/\b(CFA|CPA|MBA|PhD|BSc|MSc)\b/i)?.[0];
  if (credential) return `${subject} "${credential}" qualification education official employer biography -site:linkedin.com`;
  if (claim.category === "role" || claim.category === "identity") return `${subject} "${(organization ?? "").replace(/"/g, "")}" leadership team official current role -site:linkedin.com`;
  return `${subject} ${claim.statement.replace(/["\n]/g, " ").slice(0, 240)} official primary record -site:linkedin.com`;
}

export function singleSourceEvidence(claim: Claim) {
  if (!["unverified", "partially_verified"].includes(claim.status)) return undefined;
  const checks = [claim.check1, claim.check2].filter((check) => check && ["supported", "partially_supported"].includes(check.verdict) && check.evidence.some((ref) => ref.excerpt.trim()));
  if (checks.length !== 1) return undefined;
  return checks[0]?.evidence.find((ref) => ref.excerpt.trim());
}
