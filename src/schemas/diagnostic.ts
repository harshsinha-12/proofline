import { z } from "zod";

export const gapFindingSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  observation: z.string().min(1),
  whyItMatters: z.string().min(1),
  recommendation: z.string().min(1),
  supportingClaimIds: z.array(z.string().min(1)),
  sampledSourceIds: z.array(z.string().min(1)),
  limitation: z.string().min(1),
});

export const diagnosticReviewStatusSchema = z.enum(["draft", "approved"]);

export const diagnosticSchema = z.object({
  subjectName: z.string().min(1),
  roleLine: z.string().min(1),
  generatedAt: z.string().min(1),
  currentPositioning: z.string().min(1),
  credibilitySignals: z.array(
    z.object({
      text: z.string().min(1),
      claimIds: z.array(z.string().min(1)).min(1),
    }),
  ),
  gaps: z.array(gapFindingSchema).length(3),
  narrativeOpportunity: z.string().min(1),
  integritySummary: z.object({
    evaluated: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    partiallyVerified: z.number().int().nonnegative(),
    unverified: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    conflicts: z.number().int().nonnegative(),
  }),
  citationClaimIds: z.array(z.string().min(1)),
  reviewStatus: diagnosticReviewStatusSchema,
});

export const gapAnalystOutputSchema = z.object({
  gaps: z
    .array(
      z.object({
        title: z.string().min(1),
        observation: z.string().min(1),
        whyItMatters: z.string().min(1),
        recommendation: z.string().min(1),
        supportingClaimIds: z.array(z.string()),
        sampledSourceIds: z.array(z.string()),
        limitation: z.string().min(1),
      }),
    )
    .length(3),
});

export const diagnosticWriterStatusSchema = z.enum([
  "ok",
  "insufficient_evidence",
]);

export const diagnosticWriterOutputSchema = z.object({
  status: diagnosticWriterStatusSchema,
  diagnostic: diagnosticSchema.omit({ reviewStatus: true }).optional(),
});

export type GapFinding = z.infer<typeof gapFindingSchema>;
export type DiagnosticReviewStatus = z.infer<typeof diagnosticReviewStatusSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export type GapAnalystOutput = z.infer<typeof gapAnalystOutputSchema>;
export type DiagnosticWriterOutput = z.infer<typeof diagnosticWriterOutputSchema>;
