import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getModelRequest } from "@/lib/model-config";
import { hashJson } from "@/lib/hashing";
import { readCache, writeCache } from "@/providers/cache";
import { requireRateLimit } from "@/lib/rate-limit";
import type { PromptContract, ProviderContext } from "@/providers/types";

export function getOpenAIClient(): OpenAI {
  const key = getEnv().OPENAI_API_KEY;
  if (!key) throw new AppError("invalid_env", "OpenAI is not configured for this research run.", 503);
  return new OpenAI({ apiKey: key, maxRetries: 0, timeout: 25_000 });
}

export function providerError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof OpenAI.APIError && error.status === 429) return new AppError("rate_limited", "The provider is rate-limited. Resume shortly.", 429);
  return new AppError("provider_unavailable", "The research provider could not complete the request. Retry from the checkpoint.", 503, { cause: error });
}

export async function requestStructured<I extends z.ZodType, O extends z.ZodType>(
  contract: PromptContract<I, O>, input: z.input<I>, context: ProviderContext = {},
): Promise<z.output<O>> {
  const validated = contract.inputSchema.parse(input);
  const format = zodTextFormat(contract.outputSchema, contract.purpose);
  const hash = hashJson({ purpose: contract.purpose, system: contract.system, input: validated, model: getModelRequest(contract.purpose), schema: format.schema });
  const cached = await readCache("model", hash, contract.outputSchema);
  let cacheValid = cached !== null;
  if (cached !== null) {
    try {
      contract.validateOutput?.(contract.outputSchema.parse(cached), validated);
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof z.ZodError)) throw error;
      cacheValid = false;
      await context.record?.({ type: "model_cache_rejected", message: "Cached output failed evidence validation; requesting a fresh response.", data: { purpose: contract.purpose } });
    }
  }
  if (cached !== null && cacheValid) {
    await context.record?.({ type: "model_cache_hit", message: "Reused a validated model result for an identical stage input.", data: { purpose: contract.purpose, cacheHit: true } });
    return contract.outputSchema.parse(cached);
  }
  const client = getOpenAIClient();
  let repair = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    await requireRateLimit("openai");
    const started = Date.now();
    await context.record?.({ type: "model_request_started", message: "Calling OpenAI for structured research output.", data: { purpose: contract.purpose, model: getModelRequest(contract.purpose).model, attempt } });
    try {
      const response = await client.responses.create({
        ...getModelRequest(contract.purpose), store: false, max_output_tokens: 4_000,
        input: [
          { role: "system", content: `${contract.system}\n${repair}` },
          { role: "user", content: JSON.stringify(validated) },
        ],
        text: { format },
      }, { signal: context.signal });
      await context.record?.({ type: "model_request", message: "Structured model request completed.", data: {
        purpose: contract.purpose, model: getModelRequest(contract.purpose).model, latencyMs: Date.now() - started, attempt,
        inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0,
      } });
      if (response.output.some((item) => item.type === "message" && item.content.some((content) => content.type === "refusal"))) {
        throw new AppError("insufficient_evidence", "The model declined this research operation.", 422);
      }
      const parsed = contract.outputSchema.safeParse(JSON.parse(response.output_text || "null"));
      if (response.status !== "completed" || !parsed.success) throw new SyntaxError("Output does not match the contract.");
      contract.validateOutput?.(parsed.data, validated);
      await writeCache("model", hash, parsed.data);
      return parsed.data;
    } catch (error) {
      if (!(error instanceof SyntaxError) && !(error instanceof z.ZodError)) throw providerError(error);
      await context.record?.({ type: "model_validation_failed", message: "Model output failed schema or evidence validation.", data: { purpose: contract.purpose, attempt } });
      if (attempt === 2) throw new AppError("validation_failed", "Model output failed schema validation after one repair attempt.", 422);
      repair = "The previous response failed JSON/schema validation. Return a complete valid JSON object matching the supplied schema. Do not add evidence or facts to repair missing information.";
      if (error instanceof SyntaxError) repair += ` ${error.message}`;
    }
  }
  throw new AppError("validation_failed", "Model output could not be validated.", 422);
}
