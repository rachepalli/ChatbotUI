import { generateText } from "ai";
import { groq } from "@ai-sdk/groq";
import type { LLMProvider, LLMRequest, LLMResponse } from "@/lib/contracts/llm";

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error("timeout"));
    }, timeoutMs);
  });

  try {
    return await Promise.race([work, timeoutPromise]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function providerMessage(data: any, fallback: string) {
  return data?.error?.message || data?.message || data?.error || fallback;
}

function providerCode(status: number) {
  if (status === 401 || status === 403) return "PROVIDER_UNAVAILABLE";
  if (status === 408 || status === 504) return "PROVIDER_TIMEOUT";
  if (status === 429) return "PROVIDER_RATE_LIMITED";
  return "PROVIDER_BAD_RESPONSE";
}

function ollamaModelName(model: string) {
  return model.replace(/^ollama:/, "") || process.env.OLLAMA_MODEL || "llama3.2";
}

function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
}

class GeminiProvider implements LLMProvider {
  provider = "gemini";

  supportsModel(model: string) {
    return model.includes("gemini");
  }

  async sendMessage(input: LLMRequest): Promise<LLMResponse> {
    try {
      const timeoutMs = input.timeoutMs ?? 10000;
      const result = await withTimeout(
        fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": process.env.GOOGLE_GENERATIVE_AI_API_KEY || "",
            },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: input.message }] }],
            }),
          }
        ),
        timeoutMs
      );
      const data = await result.json();
      const message = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      if (!result.ok || !message) {
        return {
          message: "",
          model: input.model,
          usage: {},
          error: {
            code: "PROVIDER_BAD_RESPONSE",
            message: "Gemini failed to generate a response",
            provider: this.provider,
          },
        };
      }

      return { message, model: input.model, usage: {}, error: null };
    } catch (error) {
      return {
        message: "",
        model: input.model,
        usage: {},
        error: {
          code: error instanceof Error && error.message === "timeout" ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE",
          message: "Gemini request failed",
          provider: this.provider,
        },
      };
    }
  }
}

class GroqProvider implements LLMProvider {
  provider = "groq";

  supportsModel(model: string) {
    return model === "llama-8b" || model === "llama-70b";
  }

  async sendMessage(input: LLMRequest): Promise<LLMResponse> {
    try {
      const groqModel =
        input.model === "llama-8b" ? "llama-3.1-8b-instant" : "llama-3.3-70b-versatile";
      const result = await withTimeout(
        generateText({
          model: groq(groqModel),
          prompt: input.message,
        }),
        input.timeoutMs ?? 10000
      );

      return {
        message: result.text || "",
        model: input.model,
        usage: {},
        error: result.text
          ? null
          : {
              code: "PROVIDER_BAD_RESPONSE",
              message: "Groq returned empty response",
              provider: this.provider,
            },
      };
    } catch (error) {
      return {
        message: "",
        model: input.model,
        usage: {},
        error: {
          code: error instanceof Error && error.message === "timeout" ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE",
          message: "Groq request failed",
          provider: this.provider,
        },
      };
    }
  }
}

class OllamaProvider implements LLMProvider {
  provider = "ollama";

  supportsModel(model: string) {
    return model.startsWith("ollama:");
  }

  async sendMessage(input: LLMRequest): Promise<LLMResponse> {
    try {
      const result = await withTimeout(
        fetch(`${ollamaBaseUrl()}/api/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: ollamaModelName(input.model),
            prompt: input.message,
            stream: false,
          }),
        }),
        input.timeoutMs ?? 10000
      );
      const data = await result.json();
      const message = data?.response || "";

      if (!result.ok || !message) {
        return {
          message: "",
          model: input.model,
          usage: {},
          error: {
            code: providerCode(result.status),
            message: providerMessage(data, "Ollama failed to generate a response"),
            provider: this.provider,
          },
        };
      }

      return {
        message,
        model: input.model,
        usage: {
          promptTokens: data?.prompt_eval_count,
          completionTokens: data?.eval_count,
          totalTokens: (data?.prompt_eval_count || 0) + (data?.eval_count || 0) || undefined,
        },
        error: null,
      };
    } catch (error) {
      return {
        message: "",
        model: input.model,
        usage: {},
        error: {
          code: error instanceof Error && error.message === "timeout" ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE",
          message: "Ollama request failed",
          provider: this.provider,
        },
      };
    }
  }
}

export const llmProviders: LLMProvider[] = [
  new GeminiProvider(),
  new GroqProvider(),
  new OllamaProvider(),
];
