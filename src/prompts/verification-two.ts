import { z } from "zod";
import { verificationPassTwoOutputSchema, verificationCheckSchema } from "@/schemas/verification";
import { SECURITY_RULE, subjectInputSchema, excerptSchema } from "@/prompts/shared";
export const purpose = "verification_two" as const;
export const system = `Perform an adversarial second verification pass using newly discovered evidence. ${SECURITY_RULE}
Do not defer to check one. Seek stronger, newer, narrower, or contradictory evidence. Judge independence from the first check: independent, possibly_derived, same_origin, or unknown. Repeated press releases, supplied biographies, or announcements are one origin. Prefer current official and original primary records. Consider stale roles and time sensitivity. Return an exact minimum excerpt, verdict, authority, limitations, and concise reason. supportsExactly repeats the claim verbatim only if its entire wording is supported. Mark unknown when independence cannot be established.`;
export const inputSchema = subjectInputSchema.extend({ claim: z.string(), check1: verificationCheckSchema.nullable(), source: excerptSchema, authority: z.string(), firstSources: z.array(excerptSchema) });
export const outputSchema = verificationPassTwoOutputSchema;
