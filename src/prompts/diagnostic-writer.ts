import { z } from "zod";
import { diagnosticSchema, gapFindingSchema } from "@/schemas/diagnostic";
import { SECURITY_RULE, datedInputSchema, factSchema } from "@/prompts/shared";
export const purpose = "diagnostic_writer" as const;
export const system = `Write a concise one-page public-presence diagnostic suitable for a DIFC founder or fund manager. ${SECURITY_RULE}
Only supplied approved facts and precomputed gaps may enter the narrative. Every factual sentence cites supplied claim IDs. Do not infer outside facts, change attribution, omit as-of dates, or introduce a new number. Use exactly three gaps and three credibility signals. Frame recommendations as analysis. No hype, hashtags, em dashes, or generic filler. Respect the word and character budgets including gap text. Preserve generatedAt and integritySummary metadata exactly. Return insufficient_evidence with a null diagnostic if the fact set cannot support the requested structure. reviewStatus is application-owned and must be draft.`;
export const inputSchema = datedInputSchema.extend({ facts: z.array(factSchema), gaps: z.array(gapFindingSchema).length(3), roleLimitation: z.string().nullable(),
  generatedAt: z.string(), integritySummary: diagnosticSchema.shape.integritySummary, maxWords: z.number(), maxCharacters: z.number(), previousIssues: z.array(z.string()) });
export const outputSchema = z.object({ status: z.enum(["ok", "insufficient_evidence"]), diagnostic: diagnosticSchema.nullable() });
