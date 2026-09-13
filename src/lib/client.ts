import type { Claim } from "@/schemas/claim";
import type { Source } from "@/schemas/source";
import type { Diagnostic } from "@/schemas/diagnostic";
import type { ExecutionEvent, ResearchRun } from "@/schemas/run";
import { executionEventSchema, researchRunSchema } from "@/schemas/run";
import { sourceSchema } from "@/schemas/source";
import { claimSchema } from "@/schemas/claim";
import { z } from "zod";

export type RunPayload = {
  run: ResearchRun;
  sources: Source[];
  claims: Claim[];
  events: ExecutionEvent[];
  fixtureMode: boolean;
};

export type AdvancePayload = {
  runId: string;
  previousStage: ResearchRun["stage"];
  stage: ResearchRun["stage"];
  progress: ResearchRun["progress"];
  warnings: ResearchRun["warnings"];
  canContinue: boolean;
  retryAfter?: string;
};

export type ApiError = { code: string; message: string };
const runPayloadSchema = z.object({ run: researchRunSchema, sources: z.array(sourceSchema), claims: z.array(claimSchema), events: z.array(executionEventSchema), fixtureMode: z.boolean() });
const advancePayloadSchema = z.object({ runId: z.string(), previousStage: researchRunSchema.shape.stage, stage: researchRunSchema.shape.stage,
  progress: researchRunSchema.shape.progress, warnings: researchRunSchema.shape.warnings, canContinue: z.boolean(), retryAfter: z.string().optional() });

async function parseResponse<T>(response: Response): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError }> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data?.error ?? { code: "internal_error", message: "The request failed." },
    };
  }
  if (!data || typeof data !== "object") return { ok: false, status: 502, error: { code: "invalid_response", message: "The server returned an invalid response. Retry the action." } };
  return { ok: true, status: response.status, data: data as T };
}

async function request<T>(url: string, init: RequestInit = {}, schema?: z.ZodType<T>) {
  try {
    const result = await parseResponse<T>(await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(100_000) }));
    if (result.ok && schema) {
      const parsed = schema.safeParse(result.data);
      if (!parsed.success) return { ok: false as const, status: 502, error: { code: "invalid_response", message: "The server response did not match the evidence contract. Retry the action." } };
      return { ...result, data: parsed.data };
    }
    return result;
  } catch {
    return { ok: false as const, status: 503, error: { code: "network_error", message: "The server could not be reached. Retry from the saved checkpoint." } };
  }
}

export async function getRunPayload(runId: string, signal?: AbortSignal) {
  return request<RunPayload>(`/api/research/${encodeURIComponent(runId)}`, { cache: "no-store", signal }, runPayloadSchema);
}

export async function createResearchRun(input: {
  linkedInUrl: string;
  nameHint?: string;
  companyHint?: string;
  allowManualUrl?: boolean;
}) {
  return request<{ runId: string; stage: string }>("/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function advanceResearchRun(runId: string, hints?: { nameHint?: string; companyHint?: string }, signal?: AbortSignal) {
  return request<AdvancePayload>(`/api/research/${encodeURIComponent(runId)}/advance`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(hints ?? {}),
  }, advancePayloadSchema);
}

export async function reviewClaim(runId: string, claimId: string, decision: "pending" | "approved" | "excluded", note?: string) {
  return request<{ claim: Claim }>(`/api/research/${encodeURIComponent(runId)}/claims/${encodeURIComponent(claimId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, ...(note !== undefined ? { note } : {}) }),
  });
}

export async function approveEligibleClaims(runId: string) {
  return request<{ claims: Claim[] }>(`/api/research/${encodeURIComponent(runId)}/claims/approve-eligible`, { method: "POST" });
}

export async function generateDiagnostic(runId: string, roleLimitation?: string) {
  return request<{ status: "ok"; diagnostic: Diagnostic } | { status: "insufficient_evidence"; reason: string }>(
    `/api/research/${encodeURIComponent(runId)}/diagnostic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(roleLimitation ? { roleLimitation } : {}),
    },
  );
}

export async function approveDiagnosticExport(runId: string, reviewerName: string) {
  return request<{ run: ResearchRun; snapshotHash: string }>(`/api/research/${encodeURIComponent(runId)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: true, reviewerName }),
  });
}

export function citationEntries(diagnostic: Diagnostic, claims: Claim[], sources: Source[]) {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return diagnostic.citationClaimIds.map((claimId, index) => {
    const claim = claimById.get(claimId);
    const checks = [claim?.check1, claim?.check2].filter((check) => !!check).sort((a, b) => Number(b.sourceAuthorityForClaim === "qualifying") - Number(a.sourceAuthorityForClaim === "qualifying"));
    const source = checks.flatMap((check) => check.evidence).map((ref) => sourceById.get(ref.sourceId)).find((entry) => entry?.fetchStatus === "fetched") ??
      claim?.originSourceIds.map((id) => sourceById.get(id)).find((entry) => entry?.fetchStatus === "fetched");
    return {
      number: index + 1,
      claimId,
      url: source?.url,
      title: source?.title ?? claim?.statement ?? claimId,
    };
  });
}

export function citationMarks(claimIds: string[], entries: ReturnType<typeof citationEntries>) {
  return claimIds
    .map((id) => entries.find((entry) => entry.claimId === id)?.number)
    .filter((value): value is number => typeof value === "number")
    .map((number) => `[${number}]`)
    .join("");
}
