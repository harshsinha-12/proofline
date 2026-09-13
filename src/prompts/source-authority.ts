import { sourceAuthorityOutputSchema } from "@/schemas/verification";
import { z } from "zod";
import { sourceKindSchema } from "@/schemas/source";
import { SECURITY_RULE, subjectInputSchema, excerptSchema } from "@/prompts/shared";
export const purpose = "source_authority" as const;
export const system = `Judge authority for one specific claim, never a general domain trust score. ${SECURITY_RULE}
A regulator register can qualify licensing status. Company and subject pages prove attributed statements, not independently prove material performance numbers. Original posts prove what was said. Secondary coverage may repeat press releases or supplied biographies. Return qualifying, useful_but_insufficient, or not_qualifying. Identify suspected shared origin and explain derivation. Use only the supplied excerpt.`;
export const inputSchema = subjectInputSchema.extend({ claim: z.string(), source: excerptSchema, otherSources: z.array(excerptSchema) });
export const outputSchema = sourceAuthorityOutputSchema.extend({ sourceKind: sourceKindSchema, derivedFromSourceId: z.string().nullable() });
