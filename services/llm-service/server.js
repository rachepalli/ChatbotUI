const http = require("http");

const port = Number(process.env.PORT || 4004);
const serviceName = process.env.SERVICE_NAME || "llm-service";

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function mapError(code, message, provider) {
  return { code, message, provider };
}

function providerMessage(data, fallback) {
  return data?.error?.message || data?.message || fallback;
}

function safeJson(data) {
  return data ? JSON.stringify(data) : "";
}

function networkErrorMessage(error, provider) {
  const reason = error instanceof Error && error.message ? ` ${error.message}` : "";
  if (provider === "ollama") {
    return `Cannot reach Ollama at ${ollamaBaseUrl()}.${reason} Start Ollama and pull the selected model.`;
  }
  return `Provider request failed.${reason}`;
}

function providerCode(response) {
  if (response.status === 401 || response.status === 403) return "PROVIDER_UNAVAILABLE";
  if (response.status === 408 || response.status === 504) return "PROVIDER_TIMEOUT";
  if (response.status === 429) return "PROVIDER_RATE_LIMITED";
  return "PROVIDER_BAD_RESPONSE";
}

function isOllamaModel(model) {
  return model.startsWith("ollama:");
}

function normalizeModel(model) {
  const value = String(model || "").trim();
  const aliases = {
    "gemini-2.5": "gemini-2.5-flash",
    "gemini-2.0": "gemini-2.5-flash-lite",
    "gemini-2.0-flash": "gemini-2.5-flash-lite",
    "gemini-lite": "gemini-2.5-flash-lite",
    llama70b: "llama-70b",
    "llama-70b-ollama": "ollama:llama3.3:70b",
    "ollama:llama70b": "ollama:llama3.3:70b",
  };
  return aliases[value] || value || "gemini-2.5-flash";
}

function ollamaModelName(model) {
  return model.replace(/^ollama:/, "") || process.env.OLLAMA_MODEL || "llama3.2";
}

function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, "");
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function callGemini(message, model, timeoutMs) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return {
      message: "",
      model,
      usage: {},
      error: mapError("PROVIDER_UNAVAILABLE", "Missing GOOGLE_GENERATIVE_AI_API_KEY", "gemini"),
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: message }] }],
      }),
    }),
    timeoutMs
  );
  const data = await response.json().catch(() => null);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!response.ok || !text) {
    return {
      message: "",
      model,
      usage: {},
      error: mapError(providerCode(response), providerMessage(data, `Gemini bad response ${response.status}: ${safeJson(data)}`), "gemini"),
    };
  }
  return {
    message: text,
    model,
    usage: {
      promptTokens: data?.usageMetadata?.promptTokenCount,
      completionTokens: data?.usageMetadata?.candidatesTokenCount,
      totalTokens: data?.usageMetadata?.totalTokenCount,
    },
    error: null,
  };
}

async function callGroq(message, model, timeoutMs) {
  if (!process.env.GROQ_API_KEY) {
    return {
      message: "",
      model,
      usage: {},
      error: mapError("PROVIDER_UNAVAILABLE", "Missing GROQ_API_KEY", "groq"),
    };
  }

  const mappedModel =
    model === "llama-8b" ? "llama-3.1-8b-instant" : "llama-3.3-70b-versatile";
  const response = await withTimeout(
    fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: mappedModel,
        messages: [{ role: "user", content: message }],
      }),
    }),
    timeoutMs
  );
  const data = await response.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content || "";
  if (!response.ok || !text) {
    return {
      message: "",
      model,
      usage: {},
      error: mapError(providerCode(response), providerMessage(data, `Groq bad response ${response.status}: ${safeJson(data)}`), "groq"),
    };
  }
  return {
    message: text,
    model,
    usage: {
      promptTokens: data?.usage?.prompt_tokens,
      completionTokens: data?.usage?.completion_tokens,
      totalTokens: data?.usage?.total_tokens,
    },
    error: null,
  };
}

async function callOllama(message, model, timeoutMs) {
  const ollamaModel = ollamaModelName(model);
  const response = await withTimeout(
    fetch(`${ollamaBaseUrl()}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ollamaModel,
        prompt: message,
        stream: false,
      }),
    }),
    timeoutMs
  );

  const data = await response.json().catch(() => null);
  const text = data?.response || "";
  if (!response.ok || !text) {
    return {
      message: "",
      model,
      usage: {},
      error: mapError(providerCode(response), providerMessage(data, `Ollama bad response ${response.status}: ${safeJson(data)}`), "ollama"),
    };
  }

  return {
    message: text,
    model,
    usage: {
      promptTokens: data?.prompt_eval_count,
      completionTokens: data?.eval_count,
      totalTokens: (data?.prompt_eval_count || 0) + (data?.eval_count || 0) || undefined,
    },
    error: null,
  };
}

async function generateWithRetry(message, model, timeoutMs) {
  const attempts = 3;
  let lastResult = null;

  for (let i = 0; i < attempts; i += 1) {
    try {
      let result;
      if (isOllamaModel(model)) result = await callOllama(message, model, timeoutMs);
      else if (model.includes("gemini")) result = await callGemini(message, model, timeoutMs);
      else result = await callGroq(message, model, timeoutMs);

      lastResult = result;
      if (!result.error) return result;
    } catch (error) {
      if (i === attempts - 1) {
        const code = error instanceof Error && error.message === "timeout" ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE";
        const provider = isOllamaModel(model) ? "ollama" : model.includes("gemini") ? "gemini" : "groq";
        lastResult = {
          message: "",
          model,
          usage: {},
          error: mapError(code, networkErrorMessage(error, provider), provider),
        };
      }
    }
  }

  return lastResult || {
    message: "",
    model,
    usage: {},
    error: mapError("PROVIDER_UNAVAILABLE", "Provider request failed", "unknown"),
  };
}

async function generateWithFallback(message, requestedModel, timeoutMs) {
  const model = normalizeModel(requestedModel);
  const primary = await generateWithRetry(message, model, timeoutMs);
  if (!primary.error) return primary;

  const fallbackModels = ["llama-8b", "llama-70b"].filter((fallbackModel) => fallbackModel !== model);

  for (const fallbackModel of fallbackModels) {
    const fallback = await generateWithRetry(message, fallbackModel, timeoutMs);
    if (!fallback.error) {
      return {
        ...fallback,
        fallbackFrom: model,
        fallbackError: primary.error,
      };
    }
  }

  return primary;
}

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  if (url === "/health") {
    return json(res, 200, { ok: true, service: serviceName });
  }

  if (url === "/generate" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const message = body?.message || "";
      const model = body?.model || "gemini-2.5-flash";
      const timeoutMs = Number(body?.timeoutMs || 10000);

      if (!message) {
        return json(res, 400, {
          message: "",
          model,
          usage: {},
          error: mapError("INTERNAL_ERROR", "message is required", "llm-service"),
        });
      }

      const result = await generateWithFallback(message, model, timeoutMs);
      return json(res, 200, result);
    } catch {
      return json(res, 500, {
        message: "",
        model: "unknown",
        usage: {},
        error: mapError("INTERNAL_ERROR", "llm-service failed", "llm-service"),
      });
    }
  }

  return json(res, 404, { error: "Not Found", service: serviceName });
});

server.listen(port, () => {
  console.log(`${serviceName} listening on ${port}`);
});
