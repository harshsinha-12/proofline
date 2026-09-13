import type { Claim } from "@/schemas/claim";
import type { Source } from "@/schemas/source";
import type { VerificationCheck } from "@/schemas/verification";
import type { Diagnostic } from "@/schemas/diagnostic";

export function currentTimestamp(): string {
  return new Date().toISOString();
}

export function makeSource(id = "source_a", overrides: Partial<Source> = {}): Source {
  return { id, url: `https://${id}.example/about`, canonicalUrl: `https://${id}.example/about`, title: "Public record",
    retrievedAt: currentTimestamp(), fetchStatus: "fetched", sourceKind: "institutional_first_party", textExcerpt: "Alex founded Example.",
    discoveryQuery: "Alex Example", isPublic: true, notes: [], ...overrides };
}

export function makeCheck(pass: 1 | 2, source: Source, statement = "Alex founded Example.", overrides: Partial<VerificationCheck> = {}): VerificationCheck {
  return { id: `check_${pass}`, pass, verdict: "supported", evidence: [{ sourceId: source.id, url: source.url, title: source.title,
    excerpt: source.textExcerpt!, supportsExactly: statement }], sourceAuthorityForClaim: "qualifying",
    independenceFromOtherCheck: "independent", reasoning: "The public record directly supports the proposition.", limitations: [], checkedAt: currentTimestamp(), ...overrides };
}

export function makeClaim(overrides: Partial<Claim> = {}): Claim {
  const timestamp = currentTimestamp();
  return { id: "claim_a", subjectId: "subject_a", statement: "Alex founded Example.", category: "company", materiality: "low",
    containsNumber: false, timeSensitive: false, originSourceIds: ["source_a"], status: "pending", statusReason: "Awaiting checks.",
    humanDecision: "pending", createdAt: timestamp, updatedAt: timestamp, ...overrides };
}

export function verifiedClaims(): Claim[] {
  return [makeClaim({ id: "identity", category: "identity", statement: "Alex is the subject.", status: "verified", humanDecision: "approved" }),
    makeClaim({ id: "role", category: "role", statement: "Alex leads Example.", status: "verified", humanDecision: "approved" }),
    makeClaim({ id: "company", statement: "Example was founded in 2020.", containsNumber: true, status: "verified", humanDecision: "approved" })];
}

export function makeDiagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return { subjectName: "Alex", roleLine: "Example leader", generatedAt: currentTimestamp(), currentPositioning: "Alex leads Example.",
    credibilitySignals: [{ text: "Example was founded in 2020.", claimIds: ["company"] }],
    gaps: [0, 1, 2].map((index) => ({ id: `gap_${index}`, title: "Positioning opportunity", observation: "The sample offers a limited view.",
      whyItMatters: "Clear positioning may help readers.", recommendation: "Explain the public record.", supportingClaimIds: ["role"],
      sampledSourceIds: ["source_a"], limitation: "This is a bounded public-source sample." })),
    narrativeOpportunity: "Build on the documented leadership role.", integritySummary: { evaluated: 3, verified: 3, partiallyVerified: 0,
      unverified: 0, rejected: 0, conflicts: 0 }, citationClaimIds: ["company", "role"], reviewStatus: "draft", ...overrides };
}
