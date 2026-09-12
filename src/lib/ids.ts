import { randomUUID } from "node:crypto";
import { hashContent, shortHash } from "@/lib/hashing";

export function createRunId(): string {
  return `run_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

export function sourceIdFromCanonicalUrl(canonicalUrl: string): string {
  return `src_${shortHash(canonicalUrl)}`;
}

export function claimIdFromStatement(
  subjectId: string,
  statement: string,
): string {
  return `clm_${shortHash(`${subjectId}:${hashContent(statement)}`)}`;
}

export function checkId(claimId: string, pass: 1 | 2): string {
  return `chk_${claimId}_${pass}`;
}

export function gapId(runId: string, index: number): string {
  return `gap_${shortHash(`${runId}:${index}`)}`;
}

export function eventId(runId: string, sequence: number): string {
  return `evt_${shortHash(`${runId}:${sequence}`)}`;
}
