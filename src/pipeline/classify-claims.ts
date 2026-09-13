import type { Claim, ClaimStatus } from "@/schemas/claim";
import type { Source } from "@/schemas/source";
import type { VerificationCheck } from "@/schemas/verification";
import { excerptContainsStatementNumbers, isInterfaceChrome, parseQuantities, sameQuantity } from "@/lib/numbers";
import { isPrimarySourceKind } from "@/lib/source-kind";

export type ClassificationContext = {
  sources: Source[];
  identityAmbiguous?: boolean;
  wordingOverstates?: boolean;
  opinionMergedWithFact?: boolean;
  inventedDetail?: boolean;
  incompleteDecomposition?: boolean;
};

export type Classification = Pick<Claim, "status" | "statusReason">;

function result(status: ClaimStatus, statusReason: string): Classification {
  return { status, statusReason };
}

function evidenceSources(check: VerificationCheck, sources: Source[]): Source[] {
  return sources.filter((source) =>
    source.isPublic && source.fetchStatus === "fetched" &&
    check.evidence.some((ref) => ref.sourceId === source.id && ref.url === source.url &&
      !!source.textExcerpt?.includes(ref.excerpt)),
  );
}

function mentionsSourceBudget(check: VerificationCheck): boolean {
  return [check.reasoning, ...check.limitations].some((text) => /source budget/i.test(text));
}

function primaryEvidence(check: VerificationCheck, sources: Source[]): Source[] {
  return evidenceSources(check, sources).filter((source) => isPrimarySourceKind(source.sourceKind));
}

export function checksShareOrigin(check1: VerificationCheck, check2: VerificationCheck, sources: Source[]): boolean {
  if ([check1, check2].some((check) => check.independenceFromOtherCheck === "same_origin")) return true;
  return check1.evidence.some((left) => check2.evidence.some((right) => {
    if (left.sourceId === right.sourceId || left.url === right.url) return true;
    const a = sources.find((source) => source.id === left.sourceId);
    const b = sources.find((source) => source.id === right.sourceId);
    if (!a || !b) return false;
    return a.canonicalUrl === b.canonicalUrl ||
      (!!a.contentHash && a.contentHash === b.contentHash) ||
      (!!a.suspectedOriginId && a.suspectedOriginId === b.suspectedOriginId) ||
      a.suspectedOriginId === b.id || b.suspectedOriginId === a.id;
  }));
}

export function classifyClaim(claim: Claim, context: ClassificationContext): Classification {
  const { sources } = context;
  if (context.identityAmbiguous) return result("unverified", "Subject identity is unresolved.");
  if (isInterfaceChrome(claim.statement)) {
    return result("rejected", "The wording is website interface chrome, not a business fact.");
  }
  if (context.inventedDetail || context.opinionMergedWithFact || context.wordingOverstates) {
    return result("rejected", "The wording invents a detail, merges opinion with fact, or materially overstates the evidence.");
  }
  const checks = [claim.check1, claim.check2].filter((check): check is VerificationCheck => !!check);
  const credible = checks.filter((check) => check.sourceAuthorityForClaim !== "not_qualifying" && evidenceSources(check, sources).length > 0);
  const supports = credible.filter((check) => ["supported", "partially_supported"].includes(check.verdict));
  const contradictions = credible.filter((check) => check.verdict === "contradicted");
  if (contradictions.length) {
    if (!supports.length) return result("rejected", "Credible evidence contradicts the claim.");
    // Only resolve a stale secondary contradiction with a clearly newer official record.
    const newerOfficialSupport = supports.some((check) => evidenceSources(check, sources).some((source) =>
      source.sourceKind === "regulator_or_government" && !!source.publishedAt &&
      Number.isFinite(Date.parse(source.publishedAt)) && contradictions.every((other) =>
        evidenceSources(other, sources).every((old) =>
          !isPrimarySourceKind(old.sourceKind) && !!old.publishedAt &&
          Date.parse(source.publishedAt!) > Date.parse(old.publishedAt),
        ),
      ),
    ));
    return newerOfficialSupport
      ? result("partially_verified", "A newer official record resolves the stale secondary contradiction; a second exact supporting check is still required.")
      : result("conflict", "Credible sources disagree and authority or publication dates do not safely resolve the disagreement.");
  }
  if (!supports.length) {
    return result("unverified", checks.some(mentionsSourceBudget)
      ? "Source budget exhausted before independent confirmation was found."
      : "No accessible, credible evidence supports the proposition.");
  }
  const numbers = parseQuantities(claim.statement);
  const qualifying = supports.filter((check) => check.sourceAuthorityForClaim === "qualifying" && primaryEvidence(check, sources).length > 0);
  const primarySupport = supports.filter((check) => primaryEvidence(check, sources).length > 0);
  const attributableNumbers = numbers.every((quantity) => primarySupport.some((check) =>
    check.evidence.some((ref) => primaryEvidence(check, sources).some((source) => source.id === ref.sourceId) &&
      parseQuantities(ref.excerpt).some((have) => sameQuantity(quantity, have))),
  ));
  if (numbers.length > 0 && !attributableNumbers) {
    return result("rejected", "A quantitative detail has no explicitly attributable qualifying source.");
  }
  if (!qualifying.length && !primarySupport.length) {
    return result("unverified", "Only secondary or non-qualifying support is available.");
  }
  if (!claim.check1 || !claim.check2 || claim.check1.pass !== 1 || claim.check2.pass !== 2) {
    return result("partially_verified", "Credible primary support exists, but both distinct verification passes are not complete.");
  }
  if (checksShareOrigin(claim.check1, claim.check2, sources)) {
    return result("partially_verified", "The two checks share a source or underlying origin and cannot count as independent confirmation.");
  }
  if (claim.check2.independenceFromOtherCheck !== "independent" ||
    ["possibly_derived", "unknown"].includes(claim.check1.independenceFromOtherCheck)) {
    return result("partially_verified", "Independent confirmation has not been established.");
  }
  const exact = (check: VerificationCheck) => check.verdict === "supported" && check.limitations.length === 0 &&
    check.sourceAuthorityForClaim !== "not_qualifying" && check.evidence.some((ref) =>
      ref.supportsExactly.trim() === claim.statement.trim() && evidenceSources(check, sources).some((source) => source.id === ref.sourceId));
  if (!exact(claim.check1) || !exact(claim.check2) || context.incompleteDecomposition) {
    return result("partially_verified", "Support is narrower, limited, or incomplete for the exact atomic wording.");
  }
  if (claim.timeSensitive && (!claim.asOfDate || !/^\d{4}-\d{2}-\d{2}$/.test(claim.asOfDate) ||
    !Number.isFinite(Date.parse(claim.asOfDate)) || new Date(claim.asOfDate).toISOString().slice(0, 10) !== claim.asOfDate ||
    checks.some((check) => !Number.isFinite(Date.parse(check.checkedAt)) || Date.parse(claim.asOfDate!) > Date.parse(check.checkedAt)) ||
    !claim.statement.includes(claim.asOfDate))) {
    return result("partially_verified", "Time-sensitive wording must include a valid explicit as-of date.");
  }
  if (numbers.length && ![claim.check1, claim.check2].every((check) =>
    check.evidence.some((ref) => excerptContainsStatementNumbers(claim.statement, ref.excerpt)),
  )) return result("partially_verified", "The number lacks exact independent confirmation in both checks.");
  if (!qualifying.length) {
    return result("partially_verified", "First-party support exists, but independent qualifying confirmation is still required.");
  }
  return result("verified", "Both passes support the exact claim independently, with qualifying primary evidence and no unresolved limitations.");
}

export function applyClaimClassification(claim: Claim, context: ClassificationContext): Claim {
  const containsNumber = parseQuantities(claim.statement).length > 0;
  const classified = { ...claim, containsNumber };
  return { ...classified, ...classifyClaim(classified, context), updatedAt: new Date().toISOString() };
}

export function classifyClaims(claims: Claim[], context: ClassificationContext): Claim[] {
  return claims.map((claim) => applyClaimClassification(claim, context));
}
