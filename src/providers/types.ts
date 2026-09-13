import { z } from "zod";
import type { ModelPurpose } from "@/lib/model-config";

export type ProviderEvent = {
  type: string;
  message: string;
  data?: Record<string, unknown>;
};
export type ProviderContext = { record?: (event: ProviderEvent) => Promise<void>; signal?: AbortSignal };

export type PromptContract<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> = {
  purpose: ModelPurpose;
  system: string;
  inputSchema: I;
  outputSchema: O;
};

export const searchResultSchema = z.object({
  title: z.string(), url: z.url(), snippet: z.string(), publisher: z.string().optional(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SearchRequest = { query: string; maxResults: number; allowedDomains?: string[]; blockedDomains?: string[] };

export const pageResultSchema = z.object({
  url: z.url(), title: z.string(), textExcerpt: z.string().optional(), publishedAt: z.string().optional(),
  fetchStatus: z.enum(["fetched", "blocked", "not_found", "timed_out", "unsupported", "failed"]),
  retrievedAt: z.string(), notes: z.array(z.string()),
});
export type PageResult = z.infer<typeof pageResultSchema>;
