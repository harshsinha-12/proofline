import type { ResearchRun } from "@/schemas/run";
import type { Source } from "@/schemas/source";
import type { Claim } from "@/schemas/claim";
import { AppError } from "@/lib/errors";
import { hashContent, shortHash } from "@/lib/hashing";
import { sourceIdFromCanonicalUrl } from "@/lib/ids";
import { normalizeUrl } from "@/lib/urls";
import { getSources, saveSource } from "@/lib/source-store";
import { getEnv } from "@/lib/env";
import { search } from "@/providers/search";
import { fetchPage } from "@/providers/fetch-page";
import { requestStructured } from "@/providers/ai";
import type { ProviderContext, SearchResult } from "@/providers/types";

export type PipelineServices = { search: typeof search; fetchPage: typeof fetchPage; requestStructured: typeof requestStructured };
export const defaultServices: PipelineServices = { search, fetchPage, requestStructured };
export type PipelineContext = ProviderContext & { run: ResearchRun; token: string; services: PipelineServices; pipeline: NonNullable<ResearchRun["pipeline"]>; claimBudget?: number; targetId?: string; queryIndex?: number; mutate?: <T>(work: () => Promise<T>) => Promise<T> };
export type StageResult = { nextStage?: ResearchRun["stage"]; patch?: Partial<ResearchRun>; key?: string; canContinue?: boolean };

export function subjectInput(run: ResearchRun) {
  if (!run.subject) throw new AppError("insufficient_evidence", "Research cannot proceed without resolved identity.", 422);
  return { currentDate: new Date().toISOString().slice(0, 10), subject: run.subject };
}

export function toExcerpt(source: Source) {
  return { sourceId: source.id, url: source.url, title: source.title, sourceKind: source.sourceKind, publishedAt: source.publishedAt ?? null,
    textExcerpt: source.textExcerpt ?? "", suspectedOriginId: source.suspectedOriginId ?? null };
}

export function taskDone(context: PipelineContext, key: string): boolean {
  return context.run.completedStageKeys.includes(key);
}

export async function persistCandidates(context: PipelineContext, results: SearchResult[], query: string, budget = getEnv().MAX_SOURCES_PER_RUN): Promise<string[]> {
  return mutate(context, async () => {
    const existing = await getSources(context.run.id);
    const ids: string[] = [];
    for (const candidate of results) {
      let canonicalUrl: string;
      try { canonicalUrl = normalizeUrl(candidate.url); } catch { continue; }
      const url = new URL(canonicalUrl);
      if (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com")) continue;
      const id = sourceIdFromCanonicalUrl(canonicalUrl);
      const previous = existing.find((source) => source.id === id);
      if (previous) { ids.push(id); continue; }
      if (existing.length >= budget) continue;
      const source: Source = { id, url: candidate.url, canonicalUrl, title: candidate.title, ...(candidate.publisher ? { publisher: candidate.publisher } : {}),
        retrievedAt: new Date().toISOString(), fetchStatus: "failed", sourceKind: "unknown", discoveryQuery: query,
        isPublic: true, notes: ["Candidate has not been fetched yet."] };
      await saveSource(context.run.id, source, context.token);
      existing.push(source); ids.push(id);
    }
    return ids;
  });
}

export async function extractSource(context: PipelineContext, source: Source): Promise<Source> {
  await context.record?.({ type: "source_fetch_started", message: "Loading an evidence source.", data: { sourceId: source.id, url: source.canonicalUrl } });
  const page = await context.services.fetchPage(source.canonicalUrl, context);
  if (page.fetchStatus !== "fetched") await context.record?.({ type: "source_unavailable", message: page.notes.join(" "), data: { sourceId: source.id, url: source.canonicalUrl, fetchStatus: page.fetchStatus } });
  return mutate(context, async () => {
    const all = await getSources(context.run.id);
    const contentHash = page.textExcerpt ? hashContent(page.textExcerpt) : undefined;
    const same = contentHash ? all.find((other) => other.id !== source.id && other.contentHash === contentHash) : undefined;
    const updated: Source = { ...source, title: page.title, retrievedAt: page.retrievedAt, fetchStatus: page.fetchStatus, notes: page.notes,
      ...(page.textExcerpt ? { textExcerpt: page.textExcerpt, contentHash } : {}),
      ...(page.publishedAt ? { publishedAt: page.publishedAt } : {}),
      ...(same ? { suspectedOriginId: same.suspectedOriginId ?? same.id } : {}) };
    await saveSource(context.run.id, updated, context.token);
    return updated;
  });
}

export function subjectId(run: ResearchRun): string { return `sub_${shortHash(run.linkedInUrl)}`; }
export function isPendingSource(source: Source): boolean { return source.notes.includes("Candidate has not been fetched yet."); }
export function emptyCheck(claim: Claim, pass: 1 | 2, reason: string) {
  return { id: `chk_${claim.id}_${pass}`, pass, verdict: "no_evidence" as const, evidence: [], sourceAuthorityForClaim: "not_qualifying" as const,
    independenceFromOtherCheck: "unknown" as const, reasoning: reason, limitations: [reason], checkedAt: new Date().toISOString() };
}

export function mutate<T>(context: PipelineContext, work: () => Promise<T>): Promise<T> {
  return context.mutate ? context.mutate(work) : work();
}
