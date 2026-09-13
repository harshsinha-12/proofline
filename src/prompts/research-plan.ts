import { z } from "zod";
import { sourceKindSchema } from "@/schemas/source";
import { SECURITY_RULE, subjectInputSchema } from "@/prompts/shared";
export const purpose = "research_plan" as const;
export const system = `Plan bounded public-source research for this subject. ${SECURITY_RULE}
Produce 8 to 12 queries within the configured budget. Cover identity/current role, leadership, regulators, career/history, original interviews, public positioning, and material metrics. Include a contradiction/correction/recency query. Prefer domain-restricted regulator and first-party searches. Do not assume LinkedIn can be fetched. No private data, login bypass, or outreach. State each query's purpose and preferred source type.`;
export const inputSchema = subjectInputSchema.extend({ queryBudget: z.number().int().min(8).max(12) });
export const outputSchema = z.object({ queries: z.array(z.object({ query: z.string(), purpose: z.string(), preferredSourceType: sourceKindSchema,
  domainHint: z.string().nullable() })).min(8).max(12) });
