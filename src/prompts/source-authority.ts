import { sourceAuthorityOutputSchema } from "@/schemas/verification";
import { z } from "zod";
import { sourceKindSchema } from "@/schemas/source";
import { SECURITY_RULE, subjectInputSchema, excerptSchema } from "@/prompts/shared";
export const purpose = "source_authority" as const;
export const system = `Judge authority for one specific claim, never a general domain trust score. ${SECURITY_RULE}
A regulator register can qualify licensing status. Company and subject pages prove attributed statements, not independently prove material performance numbers. Judge this page's sourceKind from the publisher and URL, not from whether the current claim is independently proven: a company site remains company_first_party even when it cannot qualify a performance number. Original posts prove what was said. Secondary coverage may repeat press releases or supplied biographies. Return qualifying, useful_but_insufficient, or not_qualifying. Identify suspected shared origin and explain derivation. Use only the supplied excerpt.
derivedFromSourceId must be a sourceId from otherSources, never a URL, publisher name, or the current source's own ID. If otherSources is empty or the origin cannot be identified from those sources, return null. You may still report suspectedSharedOrigin and explain the uncertainty in derivationNote; null does not establish independence.`;
export const inputSchema = subjectInputSchema.extend({ claim: z.string(), source: excerptSchema, otherSources: z.array(excerptSchema) });
export const outputSchema = sourceAuthorityOutputSchema.extend({ sourceKind: sourceKindSchema, derivedFromSourceId: z.string().nullable() });

export function forKnownOrigins(sourceIds: string[]) {
  const ids = [...new Set(sourceIds)];
  return {
    purpose, system, inputSchema,
    outputSchema: outputSchema.extend({ derivedFromSourceId: ids.length ? z.enum(ids as [string, ...string[]]).nullable() : z.null() }),
  };
}
