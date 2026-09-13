import { AppError } from "@/lib/errors";
import { extractNumbers, hasUnattributedNumber } from "@/lib/numbers";
import type { Claim, HumanDecision } from "@/schemas/claim";
import { diagnosticSchema, type Diagnostic } from "@/schemas/diagnostic";
import type { ResearchRun } from "@/schemas/run";

export const MAX_DIAGNOSTIC_WORDS = 650;
export const MAX_DIAGNOSTIC_CHARACTERS = 5_000;
export const MIN_WRITER_CLAIMS = 3;

export type WriterFact = Pick<Claim, "id" | "statement" | "category" | "asOfDate">;
export type WriterInput =
  | { status: "ok"; facts: WriterFact[]; roleLimitation?: string }
  | { status: "insufficient_evidence"; facts: []; reason: string };

export function isEligibleClaim(claim: Claim): boolean {
  return claim.status === "verified" && claim.humanDecision === "approved";
}

export function getWriterInput(claims: Claim[], roleLimitation?: string): WriterInput {
  const eligible = claims.filter(isEligibleClaim);
  if (eligible.length < MIN_WRITER_CLAIMS || !eligible.some((claim) => claim.category === "identity") ||
    (!eligible.some((claim) => claim.category === "role") && !roleLimitation?.trim()) ||
    claims.some((claim) => claim.category === "identity" && claim.status === "conflict")) {
    return { status: "insufficient_evidence", facts: [], reason: "At least three approved verified facts, verified identity, and a verified role or explicit role limitation are required, with no unresolved identity conflict." };
  }
  return {
    status: "ok",
    ...(!eligible.some((claim) => claim.category === "role") && roleLimitation?.trim() ? { roleLimitation: roleLimitation.trim() } : {}),
    facts: eligible.map(({ id, statement, category, asOfDate }) => ({ id, statement, category, ...(asOfDate ? { asOfDate } : {}) })),
  };
}

export function reviewClaim(claim: Claim, decision: HumanDecision, note?: string): Claim {
  if (decision === "approved" && claim.status !== "verified") {
    throw new AppError("approval_not_allowed", "Only verified claims can be approved.", 409);
  }
  return { ...claim, humanDecision: decision, ...(note !== undefined ? { humanNote: note } : {}), updatedAt: new Date().toISOString() };
}

export function approveAllEligible(claims: Claim[]): Claim[] {
  return claims.map((claim) => claim.status === "verified" ? reviewClaim(claim, "approved") : claim);
}

export function invalidateDiagnosticApproval(run: ResearchRun): ResearchRun {
  const rest = { ...run };
  delete rest.approvedAt;
  delete rest.approvedBy;
  delete rest.completedAt;
  // Draft text is retained for inspection, but cannot be exported after evidence changes.
  return {
    ...rest,
    stage: run.stage === "approved" || run.stage === "completed" ? "awaiting_human_review" : run.stage,
    ...(run.diagnostic ? { diagnostic: { ...run.diagnostic, reviewStatus: "draft" as const } } : {}),
  };
}

export type DiagnosticAudit = { valid: boolean; issues: string[] };

/** Metadata counts and timestamps are ledger metadata, not writer-authored factual prose. */
function prose(diagnostic: Diagnostic): string[] {
  return [diagnostic.subjectName, diagnostic.roleLine, diagnostic.currentPositioning,
    ...diagnostic.credibilitySignals.map((signal) => signal.text),
    ...diagnostic.gaps.flatMap((gap) => [gap.title, gap.observation, gap.whyItMatters, gap.recommendation, gap.limitation]),
    diagnostic.narrativeOpportunity];
}

export function auditDiagnostic(output: unknown, approvedClaims: Claim[], roleLimitation?: string): DiagnosticAudit {
  const issues: string[] = [];
  if (approvedClaims.some((claim) => !isEligibleClaim(claim))) issues.push("Writer fact set contains a banned or unapproved claim.");
  const parsed = diagnosticSchema.strict().safeParse(output);
  if (!parsed.success) return { valid: false, issues: [...issues, "Diagnostic schema is invalid; exactly three gaps and complete structured output are required."] };
  const diagnostic = parsed.data;
  if (getWriterInput(approvedClaims, roleLimitation).status !== "ok") issues.push("Insufficient approved facts for a diagnostic.");
  const facts = new Map(approvedClaims.filter(isEligibleClaim).map((claim) => [claim.id, claim]));
  if (facts.size !== approvedClaims.length) issues.push("Writer fact IDs must be unique and eligible.");
  const localCitations = [...diagnostic.credibilitySignals.flatMap((signal) => signal.claimIds),
    ...diagnostic.gaps.flatMap((gap) => gap.supportingClaimIds)];
  for (const id of new Set([...diagnostic.citationClaimIds, ...localCitations])) {
    if (!facts.has(id)) issues.push(`Unknown or ineligible citation: ${id}.`);
  }
  if (localCitations.some((id) => !diagnostic.citationClaimIds.includes(id))) issues.push("Citation registry does not include every inline claim reference.");
  const text = prose(diagnostic).join("\n");
  const allowedFacts = approvedClaims.filter(isEligibleClaim).map((claim) => claim.statement);
  for (const number of new Set(extractNumbers(text))) {
    if (hasUnattributedNumber(number, allowedFacts)) issues.push(`Number absent from approved facts: ${number}.`);
  }
  for (const signal of diagnostic.credibilitySignals) {
    const cited = signal.claimIds.map((id) => facts.get(id)?.statement ?? "");
    if (hasUnattributedNumber(signal.text, cited)) issues.push("A credibility signal uses a number absent from its cited facts.");
  }
  if (text.includes("—")) issues.push("Em dashes are forbidden.");
  if (text.includes("#")) issues.push("Hashtags are forbidden.");
  if (text.trim().split(/\s+/).length > MAX_DIAGNOSTIC_WORDS || text.length > MAX_DIAGNOSTIC_CHARACTERS) issues.push("Diagnostic exceeds the one-page text budget.");
  return { valid: issues.length === 0, issues };
}

export function assertDiagnosticAudit(output: unknown, approvedClaims: Claim[], roleLimitation?: string): Diagnostic {
  const audit = auditDiagnostic(output, approvedClaims, roleLimitation);
  if (!audit.valid) throw new AppError("validation_failed", audit.issues.join(" "), 422);
  return diagnosticSchema.parse(output);
}

/** The caller must persist each failed attempt; no invalid output is repaired in place. */
export async function auditWithRetry(
  claims: Claim[],
  generate: (input: Extract<WriterInput, { status: "ok" }>, previousIssues: string[]) => Promise<unknown>,
  recordFailure: (audit: DiagnosticAudit, attempt: number) => Promise<void>,
  roleLimitation?: string,
): Promise<{ status: "ok"; diagnostic: Diagnostic } | Extract<WriterInput, { status: "insufficient_evidence" }>> {
  const input = getWriterInput(claims, roleLimitation);
  if (input.status !== "ok") return input;
  const approved = claims.filter(isEligibleClaim);
  let previousIssues: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const output = await generate(input, previousIssues);
    const audit = auditDiagnostic(output, approved, roleLimitation);
    if (audit.valid) return { status: "ok", diagnostic: diagnosticSchema.parse(output) };
    await recordFailure(audit, attempt);
    previousIssues = audit.issues;
  }
  throw new AppError("validation_failed", previousIssues.join(" "), 422);
}
