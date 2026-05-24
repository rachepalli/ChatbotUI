const http = require("http");
const crypto = require("crypto");

const port = Number(process.env.PORT || 4004);
const serviceName = process.env.SERVICE_NAME || "llm-service";
const defaultEmbeddingDimensions = Number(process.env.RAG_EMBEDDING_DIMENSIONS || 768);

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

function normalizeVector(values, dimensions = defaultEmbeddingDimensions) {
  const vector = Array.from({ length: dimensions }, (_, index) => Number(values?.[index] || 0));
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

function localEmbedding(text, dimensions = defaultEmbeddingDimensions) {
  const vector = Array(dimensions).fill(0);
  const tokens = String(text || "").toLowerCase().match(/[a-z0-9]{2,}/g) || [];

  for (const token of tokens) {
    const digest = crypto.createHash("sha256").update(token).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    const sign = digest[4] % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  return normalizeVector(vector, dimensions);
}

function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];

  return attachments
    .map((attachment) => ({
      name: String(attachment?.name || "Attachment").slice(0, 180),
      mimeType: String(attachment?.mimeType || "").trim(),
      data: String(attachment?.data || "").trim(),
    }))
    .filter((attachment) => attachment.mimeType.startsWith("image/") && attachment.data)
    .slice(0, 4);
}

function geminiParts(message, attachments) {
  const parts = [{ text: message }];
  for (const attachment of normalizeAttachments(attachments)) {
    parts.push({
      inlineData: {
        mimeType: attachment.mimeType,
        data: attachment.data,
      },
    });
  }
  return parts;
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
    openai: "gpt-4.1-mini",
    "openai-mini": "gpt-4.1-mini",
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

function isOpenAIModel(model) {
  return /^(gpt-|o[0-9])/.test(model);
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

async function callGemini(message, model, timeoutMs, attachments) {
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
        contents: [{ role: "user", parts: geminiParts(message, attachments) }],
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

function openAIResponseText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const parts = [];
  for (const output of data?.output || []) {
    for (const content of output?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n").trim();
}

async function callOpenAI(message, model, timeoutMs, attachments) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      message: "",
      model,
      usage: {},
      error: mapError("PROVIDER_UNAVAILABLE", "Missing OPENAI_API_KEY", "openai"),
    };
  }

  const content = [{ type: "input_text", text: message }];
  for (const attachment of normalizeAttachments(attachments)) {
    content.push({
      type: "input_image",
      image_url: `data:${attachment.mimeType};base64,${attachment.data}`,
      detail: "high",
    });
  }

  const response = await withTimeout(
    fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content }],
      }),
    }),
    timeoutMs
  );

  const data = await response.json().catch(() => null);
  const text = openAIResponseText(data);
  if (!response.ok || !text) {
    return {
      message: "",
      model,
      usage: {},
      error: mapError(providerCode(response), providerMessage(data, `OpenAI bad response ${response.status}: ${safeJson(data)}`), "openai"),
    };
  }

  return {
    message: text,
    model,
    usage: {
      promptTokens: data?.usage?.input_tokens,
      completionTokens: data?.usage?.output_tokens,
      totalTokens: data?.usage?.total_tokens,
    },
    error: null,
  };
}

async function callGeminiEmbeddings(texts, model, timeoutMs, dimensions) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return {
      embeddings: [],
      model,
      dimensions,
      error: mapError("PROVIDER_UNAVAILABLE", "Missing GOOGLE_GENERATIVE_AI_API_KEY", "gemini"),
    };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`;
  const response = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          outputDimensionality: dimensions,
        })),
      }),
    }),
    timeoutMs
  );

  const data = await response.json().catch(() => null);
  const embeddings = Array.isArray(data?.embeddings)
    ? data.embeddings.map((embedding) => normalizeVector(embedding?.values, dimensions))
    : [];

  if (!response.ok || embeddings.length !== texts.length) {
    return {
      embeddings: [],
      model,
      dimensions,
      error: mapError(providerCode(response), providerMessage(data, `Gemini embeddings bad response ${response.status}: ${safeJson(data)}`), "gemini"),
    };
  }

  return {
    embeddings,
    model,
    dimensions,
    error: null,
  };
}

async function callOpenAIEmbeddings(texts, model, timeoutMs, dimensions) {
  if (!process.env.OPENAI_API_KEY) {
    return {
      embeddings: [],
      model,
      dimensions,
      error: mapError("PROVIDER_UNAVAILABLE", "Missing OPENAI_API_KEY", "openai"),
    };
  }

  const response = await withTimeout(
    fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
        dimensions,
      }),
    }),
    timeoutMs
  );

  const data = await response.json().catch(() => null);
  const embeddings = Array.isArray(data?.data)
    ? data.data
        .sort((left, right) => Number(left?.index || 0) - Number(right?.index || 0))
        .map((embedding) => normalizeVector(embedding?.embedding, dimensions))
    : [];

  if (!response.ok || embeddings.length !== texts.length) {
    return {
      embeddings: [],
      model,
      dimensions,
      error: mapError(providerCode(response), providerMessage(data, `OpenAI embeddings bad response ${response.status}: ${safeJson(data)}`), "openai"),
    };
  }

  return {
    embeddings,
    model,
    dimensions,
    usage: {
      promptTokens: data?.usage?.prompt_tokens,
      totalTokens: data?.usage?.total_tokens,
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

async function generateWithRetry(message, model, timeoutMs, attachments) {
  const attempts = 3;
  let lastResult = null;

  for (let i = 0; i < attempts; i += 1) {
    try {
      let result;
      if (isOllamaModel(model)) result = await callOllama(message, model, timeoutMs);
      else if (isOpenAIModel(model)) result = await callOpenAI(message, model, timeoutMs, attachments);
      else if (model.includes("gemini")) result = await callGemini(message, model, timeoutMs, attachments);
      else result = await callGroq(message, model, timeoutMs);

      lastResult = result;
      if (!result.error) return result;
    } catch (error) {
      if (i === attempts - 1) {
        const code = error instanceof Error && error.message === "timeout" ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE";
        const provider = isOllamaModel(model) ? "ollama" : isOpenAIModel(model) ? "openai" : model.includes("gemini") ? "gemini" : "groq";
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

async function generateWithFallback(message, requestedModel, timeoutMs, attachments) {
  const model = normalizeModel(requestedModel);
  const primary = await generateWithRetry(message, model, timeoutMs, attachments);
  if (!primary.error) return primary;

  const fallbackModels = ["gemini-2.5-flash-lite", "gemini-2.5-flash"].filter((fallbackModel) => fallbackModel !== model);

  for (const fallbackModel of fallbackModels) {
    const fallback = await generateWithRetry(message, fallbackModel, timeoutMs, attachments);
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
      const attachments = normalizeAttachments(body?.attachments);

      if (!message) {
        return json(res, 400, {
          message: "",
          model,
          usage: {},
          error: mapError("INTERNAL_ERROR", "message is required", "llm-service"),
        });
      }

      const result = await generateWithFallback(message, model, timeoutMs, attachments);
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

  if (url === "/embed" && req.method === "POST") {
    try {
      const body = await parseBody(req);
      const texts = Array.isArray(body?.texts)
        ? body.texts.map((text) => String(text || "").slice(0, 8000))
        : [];
      const model = String(body?.model || process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small");
      const timeoutMs = Number(body?.timeoutMs || 15000);
      const dimensions = Math.min(Math.max(Number(body?.dimensions || defaultEmbeddingDimensions), 128), 3072);

      if (!texts.length) {
        return json(res, 400, {
          embeddings: [],
          model,
          dimensions,
          error: mapError("INTERNAL_ERROR", "texts are required", "llm-service"),
        });
      }

      const result = model.startsWith("text-embedding-")
        ? await callOpenAIEmbeddings(texts, model, timeoutMs, dimensions)
        : await callGeminiEmbeddings(texts, model, timeoutMs, dimensions);
      if (!result.error) return json(res, 200, result);

      return json(res, 200, {
        embeddings: texts.map((text) => localEmbedding(text, dimensions)),
        model: "local-hash-embedding",
        dimensions,
        fallbackFrom: model,
        fallbackError: result.error,
        error: null,
      });
    } catch (error) {
      const dimensions = defaultEmbeddingDimensions;
      return json(res, 500, {
        embeddings: [],
        model: "unknown",
        dimensions,
        error: mapError("INTERNAL_ERROR", error instanceof Error ? error.message : "llm-service embedding failed", "llm-service"),
      });
    }
  }

  return json(res, 404, { error: "Not Found", service: serviceName });
});

server.listen(port, () => {
  console.log(`${serviceName} listening on ${port}`);
});
