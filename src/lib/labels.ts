import type { ClaimStatus } from "@/schemas/claim";
import type { FetchStatus } from "@/schemas/source";
import type { RunStage } from "@/schemas/run";

export const STAGE_LABELS: Record<RunStage, string> = {
  created: "Starting",
  resolving_identity: "Resolving identity",
  planning_research: "Planning research",
  discovering_sources: "Discovering sources",
  extracting_sources: "Extracting sources",
  extracting_claims: "Extracting claims",
  verifying_pass_1: "First verification",
  planning_adversarial_checks: "Planning adversarial checks",
  verifying_pass_2: "Adversarial verification",
  classifying_claims: "Classifying claims",
  analyzing_gaps: "Preparing human review",
  drafting_diagnostic: "Preparing human review",
  awaiting_human_review: "Ready for human review",
  approved: "Approved for export",
  completed: "Completed",
  failed: "Failed",
};

export const STATUS_LABELS: Record<ClaimStatus, string> = {
  pending: "Pending",
  verified: "Verified",
  partially_verified: "Partially verified",
  unverified: "Unverified",
  rejected: "Rejected",
  conflict: "Conflict",
};

export const FETCH_LABELS: Record<FetchStatus, string> = {
  fetched: "Fetched",
  blocked: "Blocked",
  not_found: "Not found",
  timed_out: "Timed out",
  unsupported: "Unsupported",
  failed: "Failed",
};

export const ACTIVE_STAGES = new Set<RunStage>([
  "created",
  "resolving_identity",
  "planning_research",
  "discovering_sources",
  "extracting_sources",
  "extracting_claims",
  "verifying_pass_1",
  "planning_adversarial_checks",
  "verifying_pass_2",
  "classifying_claims",
  "analyzing_gaps",
  "drafting_diagnostic",
]);
