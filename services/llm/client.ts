import type { LLMRequest, LLMResponse } from "@/lib/contracts/llm";
import { llmProviders } from "@/services/llm/providers";

function normalizeModel(model?: string) {
  if (!model) return "gemini-2.5-flash";
  return model;
}

export async function generateLLMResponse(input: LLMRequest): Promise<LLMResponse> {
  const model = normalizeModel(input.model);
  const provider = llmProviders.find((p) => p.supportsModel(model));

  if (!provider) {
    return {
      message: "",
      model,
      usage: {},
      error: {
        code: "PROVIDER_UNAVAILABLE",
        message: `No provider found for model: ${model}`,
        provider: "none",
      },
    };
  }

  const result = await provider.sendMessage({ ...input, model });
  if (!result.error) return result;

  const fallback = llmProviders.find((p) => p.provider === "groq");
  if (!fallback || fallback.provider === provider.provider) return result;

  const fallbackResult = await fallback.sendMessage({
    message: input.message,
    model: "llama-8b",
    timeoutMs: input.timeoutMs,
  });

  return fallbackResult.error ? result : fallbackResult;
}
