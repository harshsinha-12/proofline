import { z } from "zod";

export const evidenceVerdictSchema = z.enum([
  "supported",
  "partially_supported",
  "contradicted",
  "no_evidence",
]);

export const sourceAuthorityForClaimSchema = z.enum([
  "qualifying",
  "useful_but_insufficient",
  "not_qualifying",
]);

export const independenceFromOtherCheckSchema = z.enum([
  "independent",
  "possibly_derived",
  "same_origin",
  "unknown",
]);

export const evidenceRefSchema = z.object({
  sourceId: z.string().min(1),
  url: z.string().min(1),
  title: z.string().min(1),
  excerpt: z.string().min(1),
  supportsExactly: z.string().min(1),
});

export const verificationCheckSchema = z.object({
  id: z.string().min(1),
  pass: z.union([z.literal(1), z.literal(2)]),
  verdict: evidenceVerdictSchema,
  evidence: z.array(evidenceRefSchema),
  sourceAuthorityForClaim: sourceAuthorityForClaimSchema,
  independenceFromOtherCheck: independenceFromOtherCheckSchema,
  reasoning: z.string().min(1),
  limitations: z.array(z.string()),
  checkedAt: z.string().min(1),
});

export const sourceAuthorityOutputSchema = z.object({
  sourceAuthorityForClaim: sourceAuthorityForClaimSchema,
  suspectedSharedOrigin: z.boolean(),
  derivationNote: z.string(),
  reasoning: z.string().min(1),
  sourceKind: z.enum([
    "regulator_or_government",
    "company_first_party",
    "subject_first_party",
    "institutional_first_party",
    "reputable_secondary",
    "other_secondary",
    "unknown",
  ]).optional(),
});

export const verificationPassOneOutputSchema = z.object({
  verdict: evidenceVerdictSchema,
  excerpt: z.string(),
  supportsExactly: z.string().min(1),
  sourceAuthorityForClaim: sourceAuthorityForClaimSchema,
  reasoning: z.string().min(1),
  limitations: z.array(z.string()),
});

export const adversarialQueryIntentSchema = z.enum([
  "independent_primary",
  "contradiction_or_recency",
  "scope",
]);

export const adversarialPlanOutputSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().min(1),
        intent: adversarialQueryIntentSchema,
      }),
    )
    .min(1)
    .max(3),
});

export const verificationPassTwoOutputSchema = z.object({
  verdict: evidenceVerdictSchema,
  excerpt: z.string(),
  supportsExactly: z.string().min(1),
  sourceAuthorityForClaim: sourceAuthorityForClaimSchema,
  independenceFromOtherCheck: independenceFromOtherCheckSchema,
  reasoning: z.string().min(1),
  limitations: z.array(z.string()),
});

export type EvidenceVerdict = z.infer<typeof evidenceVerdictSchema>;
export type SourceAuthorityForClaim = z.infer<typeof sourceAuthorityForClaimSchema>;
export type IndependenceFromOtherCheck = z.infer<
  typeof independenceFromOtherCheckSchema
>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type VerificationCheck = z.infer<typeof verificationCheckSchema>;
export type SourceAuthorityOutput = z.infer<typeof sourceAuthorityOutputSchema>;
export type VerificationPassOneOutput = z.infer<
  typeof verificationPassOneOutputSchema
>;
export type AdversarialPlanOutput = z.infer<typeof adversarialPlanOutputSchema>;
export type VerificationPassTwoOutput = z.infer<
  typeof verificationPassTwoOutputSchema
>;
