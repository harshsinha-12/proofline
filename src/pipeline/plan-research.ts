import * as prompt from "@/prompts/research-plan";
import type { ResolvedIdentity } from "@/schemas/run";
import { AppError } from "@/lib/errors";
import { subjectInput, type PipelineContext, type StageResult } from "@/pipeline/shared";

export function researchQuerySeeds(subject: ResolvedIdentity): string[] {
  const person = JSON.stringify(subject.fullName);
  const company = subject.organization ? JSON.stringify(subject.organization) : undefined;
  const relationship = [person, company].filter(Boolean).join(" ");
  const business = company ?? [person, subject.currentRole ? JSON.stringify(subject.currentRole) : undefined].filter(Boolean).join(" ");
  return [
    `${relationship} current role team`,
    `${person} career biography`,
    `${relationship} interview`,
    `${business} products business model`,
    `${business} funding announcements`,
    `${business} annual report results`,
    `${business} regulatory register license`,
    `${relationship} role change departure correction`,
  ];
}

export async function planResearch(context: PipelineContext): Promise<StageResult> {
  const output = await context.services.requestStructured(prompt, { ...subjectInput(context.run), queryBudget: 8, querySeeds: researchQuerySeeds(context.run.subject!) }, context);
  if (output.queries.length !== 8 || !output.queries.some((query) => /contradict|correct|recen|current|latest/i.test(query.purpose))) {
    throw new AppError("validation_failed", "Research plan must honor the eight-query budget and include a recency or contradiction check.", 422);
  }
  context.pipeline.queries = output.queries.map(({ domainHint, ...query }) => ({ ...query, ...(domainHint ? { domainHint } : {}) }));
  return { nextStage: "discovering_sources", key: "research:plan" };
}
