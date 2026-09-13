import { z } from "zod";
import { adversarialPlanOutputSchema, verificationCheckSchema } from "@/schemas/verification";
import { SECURITY_RULE, subjectInputSchema } from "@/prompts/shared";
export const purpose = "adversarial_plan" as const;
export const system = `Design an independent adversarial second check, actively seeking disproof or narrower wording. ${SECURITY_RULE}
Produce two or three focused queries: an independent primary/authoritative query, a contradiction/correction/recency query, and optionally a scope query for number, date, jurisdiction, role, or attribution. Avoid pass-one domains and underlying origin when possible. Do not merely repeat the first query.`;
export const inputSchema = subjectInputSchema.extend({ claim: z.string(), check1: verificationCheckSchema.nullable(), avoidDomains: z.array(z.string()) });
export const outputSchema = adversarialPlanOutputSchema;
