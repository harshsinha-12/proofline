import * as prompt from "@/prompts/identity";
import { getSources } from "@/lib/source-store";
import { hashJson } from "@/lib/hashing";
import { AppError } from "@/lib/errors";
import { z } from "zod";
import { persistCandidates, extractSource, toExcerpt, taskDone, type PipelineContext, type StageResult } from "@/pipeline/shared";

function normalizedField(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/&|\band\b/g, " ").replace(/[^\p{L}\p{N}]/gu, "");
}

export async function resolveIdentity(context: PipelineContext): Promise<StageResult> {
  const run = context.run;
  const hintHash = hashJson(run.hints ?? {});
  const discoveryKey = `identity:discovery:${hintHash}`;
  if (!taskDone(context, discoveryKey)) {
    const query = `${run.linkedInUrl} ${run.hints?.name ?? ""} ${run.hints?.company ?? ""} identity current company founder`;
    const results = await context.services.search({ query, maxResults: 3, blockedDomains: ["linkedin.com"] }, context);
    context.pipeline.identityCandidateIds = await persistCandidates(context, results, query);
    return { key: discoveryKey };
  }
  const sources = await getSources(run.id);
  const identitySources = sources.filter((source) => context.pipeline.identityCandidateIds.includes(source.id));
  const pending = identitySources.find((source) => !taskDone(context, `identity:fetch:${source.id}`));
  if (pending) {
    await extractSource(context, pending);
    return { key: `identity:fetch:${pending.id}` };
  }
  const fetched = identitySources.filter((source) => source.fetchStatus === "fetched" && source.textExcerpt);
  if (!fetched.length) return { canContinue: false, patch: { identityStatus: "insufficient_evidence", warnings: [...run.warnings, {
    code: "identity_ambiguous", message: "No public identity pages could be extracted. Supply a name/company hint or start a new run.", createdAt: new Date().toISOString(),
  }] } };
  const sourceId = z.enum(fetched.map((source) => source.id) as [string, ...string[]]);
  const contract = { ...prompt, outputSchema: prompt.outputSchema.extend({ fieldEvidence: z.object({
    fullName: z.array(sourceId), currentRole: z.array(sourceId), organization: z.array(sourceId), location: z.array(sourceId),
  }) }) };
  const output = await context.services.requestStructured(contract, {
    currentDate: new Date().toISOString().slice(0, 10), linkedInUrl: run.linkedInUrl, nameHint: run.hints?.name ?? null, companyHint: run.hints?.company ?? null,
    searchResults: sources.map((source) => ({ sourceId: source.id, url: source.url, title: source.title, snippet: "" })), sources: fetched.map(toExcerpt),
  }, context);
  if (output.status !== "resolved" || !output.fullName) {
    return { canContinue: false, patch: { identityStatus: output.status, warnings: [...run.warnings.filter((warning) => warning.code !== "identity_ambiguous"), {
      code: "identity_ambiguous", message: "Public evidence did not resolve one identity. Supply a name or company hint to continue.", createdAt: new Date().toISOString(),
    }] } };
  }
  if (output.canonicalLinkedInUrl !== run.linkedInUrl) throw new AppError("validation_failed", "Identity output changed the submitted profile URL.", 422);
  const fields = ["fullName", "currentRole", "organization", "location"] as const;
  for (const field of fields) {
    const value = output[field];
    if (!value) continue;
    const ids = output.fieldEvidence[field];
    if (!ids.length || ids.some((id) => !fetched.some((source) => source.id === id && normalizedField(source.textExcerpt!).includes(normalizedField(value))))) {
      throw new AppError("validation_failed", `The resolved ${field} field lacks matching fetched evidence.`, 422);
    }
  }
  if (output.aliases.some((alias) => !fetched.some((source) => source.textExcerpt!.toLowerCase().includes(alias.toLowerCase())))) throw new AppError("validation_failed", "An identity alias lacks public evidence.", 422);
  const refs = [...new Set(fields.flatMap((field) => output.fieldEvidence[field]))].map((id) => {
    const source = fetched.find((entry) => entry.id === id)!;
    return { sourceId: id, url: source.url, title: source.title, excerpt: source.textExcerpt!.slice(0, 1_000), supportsExactly: output.fullName! };
  });
  return { nextStage: "planning_research", key: `identity:resolved:${hintHash}`, patch: { identityStatus: "resolved", identityFieldEvidence: output.fieldEvidence,
    subject: { fullName: output.fullName, ...(output.currentRole ? { currentRole: output.currentRole } : {}),
      ...(output.organization ? { organization: output.organization } : {}), ...(output.location ? { location: output.location } : {}),
      canonicalLinkedInUrl: run.linkedInUrl, aliases: output.aliases, identityEvidence: refs, ambiguityNotes: output.ambiguityNotes },
    warnings: [...run.warnings.filter((warning) => warning.code !== "identity_ambiguous"), { code: "linkedin_not_fetched", message: "Identity was resolved from public sources; LinkedIn was not scraped.", createdAt: new Date().toISOString() }] } };
}
