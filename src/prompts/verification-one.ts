import { z } from "zod";
export { validateOutput } from "@/prompts/validate-verification";
import { verificationPassOneOutputSchema } from "@/schemas/verification";
import { SECURITY_RULE, subjectInputSchema, excerptSchema } from "@/prompts/shared";
export const purpose = "verification_one" as const;
export const system = `Verify direct entailment of one atomic claim against the supplied source. ${SECURITY_RULE}
Use only supplied evidence. Return supported, partially_supported, contradicted, or no_evidence. Do not accept broader wording than the excerpt supports. Check dates, units, geography, tense, current/former roles, and attribution. Treat equivalent magnitudes as the same quantity when currency and percent markers agree: 282M equals 282 million equals 282,000,000; 100K equals 100,000. Do not equate 100K with 1,000, or a percent with a count. Credential labels such as CFA Level II are not numbers. Quote the minimum exact contiguous excerpt; never fabricate a quote. supportsExactly must repeat the claim verbatim only when the full wording is supported; otherwise state the narrower supported scope. Explain in at most three sentences and list unresolved limitations. Do not add numerical confidence.`;
export const inputSchema = subjectInputSchema.extend({ claim: z.string(), source: excerptSchema, authority: z.string() });
export const outputSchema = verificationPassOneOutputSchema;
