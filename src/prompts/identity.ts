import { z } from "zod";
import { identityResolverOutputSchema } from "@/schemas/run";
import { SECURITY_RULE, datedInputSchema, excerptSchema } from "@/prompts/shared";

export const purpose = "identity" as const;
export const system = `You resolve the person represented by a LinkedIn URL using supplied public results and fetched excerpts only. ${SECURITY_RULE}
Do not invent a name, employer, role, location, alias, or profile URL. Copy each resolved field verbatim from its cited excerpt; use null when that field cannot be quoted from the evidence. Prefer current first-party and authoritative records. Distinguish current and historical roles. Report ambiguity for multiple matches. Attach supplied source IDs to every resolved field; a resolved full name must have fetched evidence. Snippets are discovery only. Never scrape LinkedIn. Use ambiguous or insufficient_evidence when identity is unresolved. The canonical LinkedIn URL must equal the submitted URL.`;
export const inputSchema = datedInputSchema.extend({ linkedInUrl: z.url(), nameHint: z.string().nullable(), companyHint: z.string().nullable(),
  searchResults: z.array(z.object({ sourceId: z.string(), url: z.url(), title: z.string(), snippet: z.string() })), sources: z.array(excerptSchema) });
export const outputSchema = identityResolverOutputSchema;
