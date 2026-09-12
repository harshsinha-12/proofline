import { z } from "zod";
import { verificationCheckSchema } from "@/schemas/verification";

export const claimStatusSchema = z.enum([
  "pending",
  "verified",
  "partially_verified",
  "unverified",
  "rejected",
  "conflict",
]);

export const claimCategorySchema = z.enum([
  "identity",
  "role",
  "career",
  "company",
  "regulatory",
  "funding",
  "performance",
  "audience",
  "public_positioning",
  "other",
]);

export const materialitySchema = z.enum(["low", "medium", "high"]);

export const humanDecisionSchema = z.enum(["pending", "approved", "excluded"]);

export const claimSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  statement: z.string().min(1),
  category: claimCategorySchema,
  materiality: materialitySchema,
  containsNumber: z.boolean(),
  timeSensitive: z.boolean(),
  asOfDate: z.string().optional(),
  originSourceIds: z.array(z.string().min(1)).min(1),
  check1: verificationCheckSchema.optional(),
  check2: verificationCheckSchema.optional(),
  status: claimStatusSchema,
  statusReason: z.string().min(1),
  humanDecision: humanDecisionSchema,
  humanNote: z.string().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const extractedClaimSchema = z.object({
  statement: z.string().min(1),
  category: claimCategorySchema,
  materiality: materialitySchema,
  containsNumber: z.boolean(),
  timeSensitive: z.boolean(),
  asOfDate: z.string().optional(),
  originSourceIds: z.array(z.string().min(1)).min(1),
  excerpt: z.string().min(1),
});

export const claimExtractionOutputSchema = z.object({
  claims: z.array(extractedClaimSchema),
});

export type ClaimStatus = z.infer<typeof claimStatusSchema>;
export type ClaimCategory = z.infer<typeof claimCategorySchema>;
export type Materiality = z.infer<typeof materialitySchema>;
export type HumanDecision = z.infer<typeof humanDecisionSchema>;
export type Claim = z.infer<typeof claimSchema>;
export type ExtractedClaim = z.infer<typeof extractedClaimSchema>;
export type ClaimExtractionOutput = z.infer<typeof claimExtractionOutputSchema>;
