import { z } from "zod";
import { gapAnalystOutputSchema } from "@/schemas/diagnostic";
import { SECURITY_RULE, datedInputSchema, factSchema } from "@/prompts/shared";
export const purpose = "gap_analysis" as const;
export const system = `Create exactly three evidence-bounded public-presence observations for a founder, CEO, or fund manager. ${SECURITY_RULE}
Use only approved verified facts and labeled source-sample metadata. Never assert that content or expertise does not exist; say what was not readily discoverable in this bounded sample. Separate observations and recommendations. Tie observations to supplied claim or sampled source IDs. Make recommendations specific to approved facts; avoid generic "post consistently" or "build thought leadership" advice. Do not introduce facts, hype, hashtags, em dashes, or filler. Include a one-sentence limitation per gap.`;
export const inputSchema = datedInputSchema.extend({ facts: z.array(factSchema), sample: z.array(z.object({ sourceId: z.string(), sourceKind: z.string(), fetchStatus: z.string(), discoveryQuery: z.string() })) });
export const outputSchema = gapAnalystOutputSchema;
