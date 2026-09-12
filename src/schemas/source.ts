import { z } from "zod";

export const sourceKindSchema = z.enum([
  "regulator_or_government",
  "company_first_party",
  "subject_first_party",
  "institutional_first_party",
  "reputable_secondary",
  "other_secondary",
  "unknown",
]);

export const fetchStatusSchema = z.enum([
  "fetched",
  "blocked",
  "not_found",
  "timed_out",
  "unsupported",
  "failed",
]);

export const sourceSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  canonicalUrl: z.string().min(1),
  title: z.string().min(1),
  publisher: z.string().optional(),
  publishedAt: z.string().optional(),
  retrievedAt: z.string().min(1),
  fetchStatus: fetchStatusSchema,
  sourceKind: sourceKindSchema,
  textExcerpt: z.string().optional(),
  contentHash: z.string().optional(),
  suspectedOriginId: z.string().optional(),
  discoveryQuery: z.string().min(1),
  isPublic: z.boolean(),
  notes: z.array(z.string()),
});

export type SourceKind = z.infer<typeof sourceKindSchema>;
export type FetchStatus = z.infer<typeof fetchStatusSchema>;
export type Source = z.infer<typeof sourceSchema>;
