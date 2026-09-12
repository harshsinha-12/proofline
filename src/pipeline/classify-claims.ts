import type { Claim, ClaimStatus } from "@/schemas/claim";
import type { Source } from "@/schemas/source";
import type { VerificationCheck } from "@/schemas/verification";
import { extractNumbers } from "@/lib/numbers";

export type ClassificationContext = {
  sources: Source[];
  identityAmbiguous?: boolean;
  wordingOverstates?: boolean;
  opinionMergedWithFact?: boolean;
  inventedDetail?: boolean;
  incompleteDecomposition?: boolean;
};

export type Classification = Pick<Claim, "status" | "statusReason">;

const PRIMARY_KINDS = new Set([
  "regulator_or_government", "company_first_party", "subject_first_party", "institutional_first_party",
]);

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
          !PRIMARY_KINDS.has(old.sourceKind) && !!old.publishedAt &&
          Date.parse(source.publishedAt!) > Date.parse(old.publishedAt),
        ),
      ),
    ));
    return newerOfficialSupport
      ? result("partially_verified", "A newer official record resolves the stale secondary contradiction; a second exact supporting check is still required.")
      : result("conflict", "Credible sources disagree and authority or publication dates do not safely resolve the disagreement.");
  }
  if (!supports.length) return result("unverified", "No accessible, credible evidence supports the proposition.");
  const numbers = extractNumbers(claim.statement);
  if (claim.containsNumber && !numbers.length) return result("rejected", "The quantitative wording cannot be deterministically attributed to a numeric evidence excerpt.");
  const qualifying = supports.filter((check) => check.sourceAuthorityForClaim === "qualifying" &&
    evidenceSources(check, sources).some((source) => PRIMARY_KINDS.has(source.sourceKind)));
  const attributableNumbers = numbers.every((number) => qualifying.some((check) =>
    check.evidence.some((ref) => evidenceSources(check, sources).some((source) => source.id === ref.sourceId && PRIMARY_KINDS.has(source.sourceKind)) &&
      extractNumbers(ref.excerpt).includes(number)),
  ));
  if ((claim.containsNumber || numbers.length > 0) && !attributableNumbers) {
    return result("rejected", "A quantitative detail has no explicitly attributable qualifying source.");
  }
  if (!qualifying.length) return result("unverified", "Only secondary or non-qualifying support is available.");
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
    numbers.every((number) => check.evidence.some((ref) => extractNumbers(ref.excerpt).includes(number))),
  )) return result("partially_verified", "The number lacks exact independent confirmation in both checks.");
  return result("verified", "Both passes support the exact claim independently, with qualifying primary evidence and no unresolved limitations.");
}

export function classifyClaims(claims: Claim[], context: ClassificationContext): Claim[] {
  return claims.map((claim) => ({ ...claim, ...classifyClaim(claim, context) }));
}
