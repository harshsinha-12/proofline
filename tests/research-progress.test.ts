import { describe, expect, it } from "vitest";
import { getResearchProgress, RESEARCH_STEPS } from "@/lib/research-progress";
import { researchRunSchema, type RunStage } from "@/schemas/run";

function run(stage: RunStage) {
  return researchRunSchema.parse({
    id: "progress-test", linkedInUrl: "https://linkedin.com/in/example", stage,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    progress: { sourcesDiscovered: 0, sourcesFetched: 0, claimsExtracted: 0, checksCompleted: 0, verifiedClaims: 0, excludedClaims: 0 },
    warnings: [], completedStageKeys: [],
  });
}

describe("research progress", () => {
  it("updates within a stage as checkpoints finish", () => {
    const current = run("verifying_pass_1");
    current.progress.claimsExtracted = 10;
    const initial = getResearchProgress(current).percent;
    current.completedStageKeys = ["check1:clm_a", "check1:clm_b", "check1:clm_c"];
    expect(getResearchProgress(current).percent).toBeGreaterThan(initial);
    current.stage = "verifying_pass_2";
    current.completedStageKeys = ["check2:search:clm_a:0", "check2:examined:clm_a:src_a"];
    const searching = getResearchProgress(current).percent;
    current.completedStageKeys.push("check2:clm_a", "check2:clm_b");
    expect(getResearchProgress(current).percent).toBeGreaterThan(searching);
  });
  it("never reports research complete before the review checkpoint", () => {
    const percentages = RESEARCH_STEPS.map((stage) => getResearchProgress(run(stage)).percent);
    expect(percentages).toEqual([...percentages].sort((a, b) => a - b));
    expect(percentages.every((percent) => percent < 100)).toBe(true);
    expect(getResearchProgress(run("created")).percent).toBe(0);
    expect(getResearchProgress(run("awaiting_human_review"))).toMatchObject({ percent: 100, ready: true, remaining: [] });
  });

  it("retains incomplete progress on failure rather than counting failure as completion", () => {
    const failed = run("failed");
    failed.fatalError = { code: "provider_failed", message: "Request failed", createdAt: failed.updatedAt, stage: "verifying_pass_1" };
    expect(getResearchProgress(failed)).toEqual(getResearchProgress(run("verifying_pass_1")));
    expect(getResearchProgress(run("failed")).percent).toBe(0);
  });
});
