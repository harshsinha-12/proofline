export const OPENAI_MODEL = "gpt-5.6-luna" as const;

export type OpenAIModel = typeof OPENAI_MODEL;

export type ModelPurpose =
  | "identity"
  | "research_plan"
  | "claim_extraction"
  | "source_authority"
  | "verification_one"
  | "adversarial_plan"
  | "verification_two"
  | "gap_analysis"
  | "diagnostic_writer";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export function getOpenAIModel(_purpose?: ModelPurpose): OpenAIModel {
  return OPENAI_MODEL;
}

export function getReasoningEffort(_purpose?: ModelPurpose): ReasoningEffort {
  return "low";
}

export function getModelRequest(purpose?: ModelPurpose) {
  return {
    model: getOpenAIModel(purpose),
    reasoning: { effort: getReasoningEffort(purpose) },
  };
}
