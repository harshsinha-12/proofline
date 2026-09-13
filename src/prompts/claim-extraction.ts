import { z } from "zod";
import { claimCategorySchema, materialitySchema } from "@/schemas/claim";
import { SECURITY_RULE, subjectInputSchema, excerptSchema } from "@/prompts/shared";
export const purpose = "claim_extraction" as const;
export const system = `Extract atomic factual claims present in the supplied excerpts. ${SECURITY_RULE}
Every excerpt must be a contiguous, character-for-character substring of the current source textExcerpt. Do not paraphrase quotes, change punctuation, add ellipses, or combine separate passages. If you cannot copy an exact supporting substring, omit that claim. Existing claims are deduplication context, not source evidence.
One proposition per claim. Split roles, dates, numbers, names, and achievements when independently testable. Preserve attribution: "the company says X" differs from "X is true". Mark number, time sensitivity, and materiality. For time-sensitive claims, include the explicit as-of date in the statement. Copy the smallest exact supporting excerpt and originating source IDs. Ignore promotional adjectives and opinions; never infer negatives from absence. Deduplicate semantic equivalents against existingClaims, merging source IDs with the existing statement verbatim. Respect maxClaims; return an empty array if no factual claims can be extracted.`;
export const inputSchema = subjectInputSchema.extend({ sources: z.array(excerptSchema), existingClaims: z.array(z.object({ statement: z.string(), originSourceIds: z.array(z.string()) })), maxClaims: z.number().int().positive() });
export const outputSchema = z.object({ claims: z.array(z.object({ statement: z.string().min(1), category: claimCategorySchema, materiality: materialitySchema,
  containsNumber: z.boolean(), timeSensitive: z.boolean(), asOfDate: z.string().nullable(), originSourceIds: z.array(z.string()).min(1), excerpt: z.string().min(1) })) });
