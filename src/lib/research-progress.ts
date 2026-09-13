import type { ResearchRun, RunStage } from "@/schemas/run";

export const RESEARCH_STEPS: RunStage[] = [
  "resolving_identity", "planning_research", "discovering_sources", "extracting_sources",
  "extracting_claims", "verifying_pass_1", "planning_adversarial_checks", "verifying_pass_2",
  "classifying_claims", "analyzing_gaps", "drafting_diagnostic",
];

export function getResearchProgress(run: ResearchRun) {
  const ready = ["awaiting_human_review", "approved", "completed"].includes(run.stage);
  // A failed run retains its last active stage rather than appearing complete.
  const stage = run.stage === "failed" ? run.fatalError?.stage ?? "created" : run.stage;
  const index = RESEARCH_STEPS.indexOf(stage);
  const completed = ready ? RESEARCH_STEPS.length : Math.max(0, index);
  const tasks: Partial<Record<RunStage, [string, number]>> = {
    discovering_sources: ["discovery:", run.pipeline?.queries.length ?? 0],
    extracting_sources: ["source:extracted:", run.progress.sourcesDiscovered],
    extracting_claims: ["claims:extracted:", run.progress.sourcesFetched],
    verifying_pass_1: ["check1:", run.progress.claimsExtracted],
    planning_adversarial_checks: ["adversarial:", run.progress.claimsExtracted],
    verifying_pass_2: ["check2:", run.progress.claimsExtracted],
  };
  const task = tasks[stage];
  const finished = task ? run.completedStageKeys.filter((key) => key.startsWith(task[0]) && key !== `${task[0]}complete` && (stage !== "verifying_pass_2" || /^check2:clm_[^:]+$/.test(key))).length : 0;
  const fraction = task && task[1] > 0 ? Math.min(1, finished / task[1]) : 0;
  return {
    ready,
    completed,
    total: RESEARCH_STEPS.length,
    percent: ready ? 100 : Math.min(99, Math.floor((completed + fraction) / RESEARCH_STEPS.length * 100)),
    remaining: RESEARCH_STEPS.slice(completed),
  };
}
