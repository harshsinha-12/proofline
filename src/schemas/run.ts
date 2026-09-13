import { z } from "zod";
import { diagnosticSchema, gapFindingSchema } from "@/schemas/diagnostic";
import { sourceKindSchema } from "@/schemas/source";
import { evidenceRefSchema, adversarialPlanOutputSchema, sourceAuthorityOutputSchema, verificationCheckSchema } from "@/schemas/verification";

export const runStageSchema = z.enum([
  "created",
  "resolving_identity",
  "planning_research",
  "discovering_sources",
  "extracting_sources",
  "extracting_claims",
  "verifying_pass_1",
  "planning_adversarial_checks",
  "verifying_pass_2",
  "classifying_claims",
  "analyzing_gaps",
  "drafting_diagnostic",
  "awaiting_human_review",
  "approved",
  "completed",
  "failed",
]);

export const runWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  createdAt: z.string().min(1),
  sourceId: z.string().optional(),
  claimId: z.string().optional(),
});

export const safeErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  createdAt: z.string().min(1),
  stage: runStageSchema.optional(),
});

export const runProgressSchema = z.object({
  sourcesDiscovered: z.number().int().nonnegative(),
  sourcesFetched: z.number().int().nonnegative(),
  claimsExtracted: z.number().int().nonnegative(),
  checksCompleted: z.number().int().nonnegative(),
  verifiedClaims: z.number().int().nonnegative(),
  excludedClaims: z.number().int().nonnegative(),
});

export const resolvedIdentitySchema = z.object({
  fullName: z.string().min(1),
  currentRole: z.string().optional(),
  organization: z.string().optional(),
  location: z.string().optional(),
  canonicalLinkedInUrl: z.string().min(1),
  aliases: z.array(z.string()),
  identityEvidence: z.array(evidenceRefSchema),
  ambiguityNotes: z.array(z.string()),
});

export const researchRunSchema = z.object({
  id: z.string().min(1),
  linkedInUrl: z.string().min(1),
  stage: runStageSchema,
  subject: resolvedIdentitySchema.optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  completedAt: z.string().optional(),
  approvedAt: z.string().optional(),
  approvedBy: z.string().optional(),
  progress: runProgressSchema,
  warnings: z.array(runWarningSchema),
  fatalError: safeErrorSchema.optional(),
  completedStageKeys: z.array(z.string()),
  diagnostic: diagnosticSchema.optional(),
  diagnosticRoleLimitation: z.string().max(500).optional(),
  hints: z.object({ name: z.string().max(150).optional(), company: z.string().max(150).optional() }).optional(),
  identityStatus: z.enum(["resolved", "ambiguous", "insufficient_evidence"]).optional(),
  identityFieldEvidence: z.object({ fullName: z.array(z.string()), currentRole: z.array(z.string()), organization: z.array(z.string()), location: z.array(z.string()) }).optional(),
  gaps: z.array(gapFindingSchema).length(3).optional(),
  retryAfter: z.string().optional(),
  pipeline: z.object({
    identityCandidateIds: z.array(z.string()).max(3).default([]),
    queries: z.array(z.object({ query: z.string(), purpose: z.string(), preferredSourceType: sourceKindSchema, domainHint: z.string().optional() })).max(12).default([]),
    attempts: z.record(z.string(), z.number().int()).default({}),
    adversarialPlans: z.record(z.string(), adversarialPlanOutputSchema).default({}),
    verificationCandidates: z.record(z.string(), z.array(z.string()).max(6)).default({}),
    authorityDecisions: z.record(z.string(), sourceAuthorityOutputSchema).default({}),
    secondChecks: z.record(z.string(), z.array(verificationCheckSchema).max(6)).default({}),
    eventSequence: z.number().int().nonnegative().default(0),
  }).optional(),
});

export const executionEventSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  stage: runStageSchema,
  type: z.string().min(1),
  message: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const identityResolverStatusSchema = z.enum([
  "resolved",
  "ambiguous",
  "insufficient_evidence",
]);

export const identityResolverOutputSchema = z.object({
  status: identityResolverStatusSchema,
  fullName: z.string().nullable(),
  currentRole: z.string().nullable(),
  organization: z.string().nullable(),
  location: z.string().nullable(),
  canonicalLinkedInUrl: z.string().min(1),
  aliases: z.array(z.string()),
  fieldEvidence: z.object({
    fullName: z.array(z.string()),
    currentRole: z.array(z.string()),
    organization: z.array(z.string()),
    location: z.array(z.string()),
  }),
  ambiguityNotes: z.array(z.string()),
});

export const researchQuerySchema = z.object({
  query: z.string().min(1),
  purpose: z.string().min(1),
  preferredSourceType: sourceKindSchema,
  domainHint: z.string().optional(),
});

export const researchPlanOutputSchema = z.object({
  queries: z.array(researchQuerySchema).min(1).max(12),
});

export type RunStage = z.infer<typeof runStageSchema>;
export type RunWarning = z.infer<typeof runWarningSchema>;
export type SafeError = z.infer<typeof safeErrorSchema>;
export type RunProgress = z.infer<typeof runProgressSchema>;
export type ResolvedIdentity = z.infer<typeof resolvedIdentitySchema>;
export type ResearchRun = z.infer<typeof researchRunSchema>;
export type ExecutionEvent = z.infer<typeof executionEventSchema>;
export type IdentityResolverOutput = z.infer<typeof identityResolverOutputSchema>;
export type ResearchPlanOutput = z.infer<typeof researchPlanOutputSchema>;
