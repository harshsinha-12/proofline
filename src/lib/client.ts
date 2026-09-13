import type { Claim } from "@/schemas/claim";
import type { Source } from "@/schemas/source";
import type { Diagnostic } from "@/schemas/diagnostic";
import type { ExecutionEvent, ResearchRun } from "@/schemas/run";

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

async function parseResponse<T>(response: Response): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError }> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: data?.error ?? { code: "internal_error", message: "The request failed." },
    };
  }
  return { ok: true, status: response.status, data: data as T };
}

export async function getRunPayload(runId: string) {
  return parseResponse<RunPayload>(await fetch(`/api/research/${runId}`, { cache: "no-store" }));
}

export async function createResearchRun(input: {
  linkedInUrl: string;
  nameHint?: string;
  companyHint?: string;
  allowManualUrl?: boolean;
}) {
  return parseResponse<{ runId: string; stage: string }>(await fetch("/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function advanceResearchRun(runId: string, hints?: { nameHint?: string; companyHint?: string }) {
  return parseResponse<AdvancePayload>(await fetch(`/api/research/${runId}/advance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(hints ?? {}),
  }));
}

export async function reviewClaim(runId: string, claimId: string, decision: "pending" | "approved" | "excluded", note?: string) {
  return parseResponse<{ claim: Claim }>(await fetch(`/api/research/${runId}/claims/${claimId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, ...(note !== undefined ? { note } : {}) }),
  }));
}

export async function approveEligibleClaims(runId: string) {
  return parseResponse<{ claims: Claim[] }>(await fetch(`/api/research/${runId}/claims/approve-eligible`, { method: "POST" }));
}

export async function generateDiagnostic(runId: string, roleLimitation?: string) {
  return parseResponse<{ status: "ok"; diagnostic: Diagnostic } | { status: "insufficient_evidence"; reason: string }>(
    await fetch(`/api/research/${runId}/diagnostic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(roleLimitation ? { roleLimitation } : {}),
    }),
  );
}

export async function approveDiagnosticExport(runId: string, reviewerName: string) {
  return parseResponse<{ run: ResearchRun; snapshotHash: string }>(await fetch(`/api/research/${runId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmation: true, reviewerName }),
  }));
}

export function citationEntries(diagnostic: Diagnostic, claims: Claim[], sources: Source[]) {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return diagnostic.citationClaimIds.map((claimId, index) => {
    const claim = claimById.get(claimId);
    const source = claim?.originSourceIds.map((id) => sourceById.get(id)).find(Boolean);
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
