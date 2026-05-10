const http = require("http");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const zlib = require("zlib");

let mammoth = null;
try {
  mammoth = require("mammoth");
} catch {
  mammoth = null;
}

const port = Number(process.env.PORT || 4003);
const serviceName = process.env.SERVICE_NAME || "chat-service";
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
const llmServiceUrl = (process.env.LLM_SERVICE_URL || "http://localhost:4004").replace(/\/$/, "");
const ragServiceUrl = (process.env.RAG_SERVICE_URL || "http://localhost:4005").replace(/\/$/, "");
const tavilySearchUrl = "https://api.tavily.com/search";

let mongoClient;
let db;

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function getDb() {
  if (!mongoUri) throw new Error("MONGODB_URI is required");

  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    db = mongoClient.db(dbName);
    await db.collection("threads").createIndex({ chatId: 1, userId: 1 }, { unique: true });
    await db.collection("messages").createIndex({ threadId: 1, userId: 1, createdAt: 1 });
  }

  return db;
}

function getUserId(req) {
  const userId = req.headers["x-user-id"];
  return typeof userId === "string" && userId.trim() ? userId.trim() : "";
}

function publicDocument(doc) {
  if (!doc) return null;
  return {
    ...doc,
    _id: doc._id?.toString(),
  };
}

function buildAutoTitle(message) {
  return message.replace(/\s+/g, " ").trim().slice(0, 50) || "New Chat";
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

function normalizeSearchResult(result, index) {
  return {
    index: index + 1,
    title: String(result?.title || "Untitled source").trim(),
    url: String(result?.url || "").trim(),
    content: String(result?.content || result?.raw_content || "").replace(/\s+/g, " ").trim(),
    score: result?.score,
  };
}

function formatSearchContext(search) {
  if (!search?.sources?.length) return "";

  const sourceBlocks = search.sources
    .map((source) => {
      const content = source.content ? `\nExcerpt: ${source.content.slice(0, 1200)}` : "";
      return `[${source.index}] ${source.title}\nURL: ${source.url}${content}`;
    })
    .join("\n\n");

  return [
    `Current date: ${new Date().toISOString().slice(0, 10)}`,
    "Use the web search results below when they are relevant.",
    "Cite sources inline with bracket numbers like [1]. If the sources do not answer the question, say so clearly.",
    "",
    "Web search results:",
    sourceBlocks,
  ].join("\n");
}

function appendSources(reply, sources) {
  if (!sources?.length) return reply;

  const sourceList = sources
    .filter((source) => source.url)
    .map((source) => `${source.index}. [${source.title}](${source.url})`)
    .join("\n");

  return sourceList ? `${reply}\n\nSources:\n${sourceList}` : reply;
}

function publicAttachment(attachment) {
  const copy = { ...attachment };
  delete copy.dataUrl;
  delete copy.text;
  return copy;
}

function decodeEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function normalizeExtractedText(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
    .slice(0, 24000);
}

function bufferFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

function unzipEntries(buffer) {
  const entries = new Map();
  let offset = 0;

  while (offset < buffer.length - 46) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x02014b50) {
      offset += 1;
      continue;
    }

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = buffer.toString("utf8", nameStart, nameStart + fileNameLength);

    if (localHeaderOffset <= buffer.length - 30 && buffer.readUInt32LE(localHeaderOffset) === 0x04034b50) {
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      const stored = uncompressedSize > 0 ? compressed.subarray(0, uncompressedSize) : compressed;

      try {
        if (method === 0) entries.set(name, stored);
        if (method === 8) {
          try {
            entries.set(name, zlib.inflateRawSync(compressed));
          } catch {
            entries.set(name, zlib.inflateSync(compressed));
          }
        }
      } catch {
        // Skip entries that cannot be inflated; other DOCX parts may still be readable.
      }
    }

    offset = nameStart + fileNameLength + extraLength + commentLength;
  }

  if (!entries.size) {
    offset = 0;
    while (offset < buffer.length - 30) {
      if (buffer.readUInt32LE(offset) !== 0x04034b50) {
        offset += 1;
        continue;
      }

      const method = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const fileNameLength = buffer.readUInt16LE(offset + 26);
      const extraLength = buffer.readUInt16LE(offset + 28);
      const nameStart = offset + 30;
      const dataStart = nameStart + fileNameLength + extraLength;
      const name = buffer.toString("utf8", nameStart, nameStart + fileNameLength);

      if (!name || compressedSize <= 0 || dataStart + compressedSize > buffer.length) {
        offset = dataStart;
        continue;
      }

      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      try {
        if (method === 0) entries.set(name, compressed);
        if (method === 8) {
          try {
            entries.set(name, zlib.inflateRawSync(compressed));
          } catch {
            entries.set(name, zlib.inflateSync(compressed));
          }
        }
      } catch {
        // Continue scanning local ZIP entries.
      }

      offset = dataStart + compressedSize;
    }
  }

  return entries;
}

function docxXmlToText(xml) {
  const source = String(xml || "")
    .replace(/<[^>]*:tab\b[^>]*\/>/g, "\t")
    .replace(/<[^>]*:br\b[^>]*\/>|<[^>]*:cr\b[^>]*\/>/g, "\n")
    .replace(/<\/[^>]*:p>/g, "\n")
    .replace(/<\/[^>]*:tr>/g, "\n");

  const textRuns = [];
  const textPattern = /<[^>]*:t\b[^>]*>([\s\S]*?)<\/[^>]*:t>/g;
  let match;
  while ((match = textPattern.exec(source))) {
    textRuns.push(decodeEntities(match[1]));
  }

  if (textRuns.length) return normalizeExtractedText(textRuns.join(" "));

  return normalizeExtractedText(decodeEntities(source.replace(/<[^>]+>/g, "")));
}

function extractDocxText(buffer) {
  const entries = unzipEntries(buffer);
  const docxParts = Array.from(entries.keys())
    .filter((name) => {
      const normalized = name.replace(/\\/g, "/").toLowerCase();
      return (
        normalized === "word/document.xml" ||
        /^word\/(header|footer|footnotes|endnotes|comments)\d*\.xml$/.test(normalized)
      );
    })
    .sort((a, b) => {
      if (a.toLowerCase() === "word/document.xml") return -1;
      if (b.toLowerCase() === "word/document.xml") return 1;
      return a.localeCompare(b);
    });

  return normalizeExtractedText(
    docxParts
      .map((name) => (entries.has(name) ? docxXmlToText(entries.get(name).toString("utf8")) : ""))
      .filter(Boolean)
      .join("\n\n")
  );
}

async function extractDocxTextWithParser(buffer) {
  if (!mammoth) return "";

  const result = await mammoth.extractRawText({ buffer });
  return normalizeExtractedText(result?.value || "");
}

async function extractImageTextWithVision(attachment, payload) {
  if (!payload?.mimeType?.startsWith("image/")) return "";

  try {
    const response = await withTimeout(
      fetch(`${llmServiceUrl}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          timeoutMs: 20000,
          message: [
            "Analyze this image for RAG ingestion.",
            "Extract every readable word, number, label, heading, table value, or handwritten note you can see.",
            "Then add a concise factual description of the image contents.",
            "Do not guess hidden information. If no readable text is present, describe only visible objects and context.",
          ].join(" "),
          attachments: [
            {
              name: attachment.name,
              mimeType: payload.mimeType,
              data: payload.buffer.toString("base64"),
            },
          ],
        }),
      }),
      24000
    );

    const data = await response.json().catch(() => null);
    if (!response.ok || data?.error || !String(data?.model || "").includes("gemini")) return "";

    return normalizeExtractedText(
      [`Image analysis for ${attachment.name}:`, data?.message || ""].filter(Boolean).join("\n")
    );
  } catch {
    return "";
  }
}

function decodePdfLiteralString(value) {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, code) => {
      const replacements = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
      return replacements[code] || code;
    })
    .replace(/\\([0-7]{1,3})/g, (_, code) => String.fromCharCode(parseInt(code, 8)));
}

function decodePdfHexString(value) {
  const clean = value.replace(/\s+/g, "");
  const even = clean.length % 2 === 0 ? clean : `${clean}0`;
  const bytes = [];
  for (let i = 0; i < even.length; i += 2) {
    bytes.push(parseInt(even.slice(i, i + 2), 16));
  }
  return Buffer.from(bytes).toString("utf8").replace(/\u0000/g, "");
}

function extractPdfTextFromContent(content) {
  const text = [];
  const literalPattern = /\((?:\\.|[^\\)])*\)\s*(?:Tj|'|"|\])/g;
  const hexPattern = /<([0-9a-fA-F\s]+)>\s*(?:Tj|'|"|\])/g;
  let match;

  while ((match = literalPattern.exec(content))) {
    text.push(decodePdfLiteralString(match[0].replace(/\s*(?:Tj|'|"|\])$/, "").slice(1, -1)));
  }
  while ((match = hexPattern.exec(content))) {
    text.push(decodePdfHexString(match[1]));
  }

  return text.join(" ");
}

function extractPdfText(buffer) {
  const raw = buffer.toString("latin1");
  const streams = [];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match;

  while ((match = streamPattern.exec(raw))) {
    const dictionary = match[1];
    const streamBytes = Buffer.from(match[2], "latin1");
    if (/\/FlateDecode/.test(dictionary)) {
      try {
        streams.push(zlib.inflateSync(streamBytes).toString("latin1"));
      } catch {
        streams.push(match[2]);
      }
    } else {
      streams.push(match[2]);
    }
  }

  const streamText = normalizeExtractedText(streams.map(extractPdfTextFromContent).join("\n"));
  if (streamText) return streamText;

  const fallback = raw.match(/[A-Za-z0-9][A-Za-z0-9 .,;:!?'"()\-[\]{}\/\\]{5,}/g);
  return normalizeExtractedText((fallback || []).join(" "));
}

async function extractAttachmentText(attachment) {
  if (attachment.text) return normalizeExtractedText(attachment.text);

  const payload = bufferFromDataUrl(attachment.dataUrl);
  if (!payload) return "";

  const name = attachment.name.toLowerCase();
  const type = attachment.type || payload.mimeType;

  try {
    if (payload.mimeType.startsWith("image/") || type.startsWith("image/")) {
      return extractImageTextWithVision(attachment, payload);
    }
    if (type === "application/pdf" || name.endsWith(".pdf")) {
      return extractPdfText(payload.buffer);
    }
    if (
      type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      name.endsWith(".docx")
    ) {
      const parsedText = await extractDocxTextWithParser(payload.buffer);
      return parsedText || extractDocxText(payload.buffer);
    }
  } catch {
    return "";
  }

  return "";
}

async function normalizeAttachments(attachments) {
  if (!Array.isArray(attachments)) return [];

  const normalized = await Promise.all(
    attachments.map(async (attachment) => {
      const type = String(attachment?.type || "").trim();
      const name = String(attachment?.name || "Attachment").trim().slice(0, 180);
      const size = Number(attachment?.size || 0);
      const kind = attachment?.kind === "image" || type.startsWith("image/") ? "image" : "document";
      const text = typeof attachment?.text === "string" ? attachment.text.slice(0, 24000) : "";
      const dataUrl = typeof attachment?.dataUrl === "string" ? attachment.dataUrl : "";
      const normalized = {
        name,
        type: type || "application/octet-stream",
        size: Number.isFinite(size) ? size : 0,
        kind,
        text,
        dataUrl,
      };

      return {
        ...normalized,
        text: await extractAttachmentText(normalized),
      };
    })
  );

  return normalized
    .filter((attachment) => attachment.name && (attachment.text || attachment.dataUrl || attachment.kind === "document"))
    .slice(0, 8);
}

function attachmentId(attachment) {
  return crypto
    .createHash("sha256")
    .update(`${attachment.name}:${attachment.size}:${attachment.type}:${attachment.text}`)
    .digest("hex");
}

async function callRagService(path, body, timeoutMs = 20000) {
  const response = await withTimeout(
    fetch(`${ragServiceUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    timeoutMs
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `RAG service failed with ${response.status}`);
  return data || {};
}

async function storeRagChunks(_database, { userId, threadId, messageId, attachments, createdAt }) {
  const ingestableAttachments = attachments
    .filter((attachment) => attachment.text)
    .map((attachment) => ({
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      text: attachment.text,
      attachmentId: attachmentId(attachment),
    }));

  if (!ingestableAttachments.length) return [];

  try {
    const data = await callRagService("/ingest", {
      userId,
      threadId,
      messageId,
      attachments: ingestableAttachments,
      createdAt,
    });
    return Array.isArray(data.chunks) ? data.chunks : [];
  } catch {
    return [];
  }
}

async function retrieveRagChunks(_database, { userId, threadId, query, limit = 6, summaryMode = false, attachments = [] }) {
  try {
    const data = await callRagService("/search", {
      userId,
      threadId,
      query,
      limit,
      summaryMode,
      attachmentIds: attachments.filter((attachment) => attachment.text).map(attachmentId),
    });
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}

function isSummaryRequest(message) {
  return /\b(summarize|summary|overview|brief|explain\s+this|analyze\s+this|key\s+points|main\s+points)\b/i.test(
    String(message || "")
  );
}

function shouldUseWebSearch(message) {
  const value = String(message || "").toLowerCase();
  return (
    /\b(today|latest|current|recent|news|now|live|this week|this month|this year|2026)\b/.test(value) ||
    /\b(search|web|internet|online|look up|lookup|browse|google)\b/.test(value) ||
    /\b(price|rate|market|stock|weather|score|schedule|release date|version|update|available now)\b/.test(value) ||
    /\b(gold|silver|commodity|crypto|bitcoin|ethereum|exchange rate)\b/.test(value)
  );
}

function shouldUseRag(message, attachments) {
  if (attachments.some((attachment) => attachment.text)) return true;

  return /\b(document|documents|file|files|attachment|attached|pdf|docx|chunk|chunks|uploaded|based on|according to)\b/i.test(
    String(message || "")
  );
}

function formatRagContext(chunks, options = {}) {
  if (!chunks.length) return "";

  const blocks = chunks
    .map((chunk, index) => {
      return `[RAG ${index + 1}] ${chunk.fileName} (chunk ${chunk.chunkIndex + 1})\n${String(chunk.chunkText || chunk.text || "").slice(0, 1600)}`;
    })
    .join("\n\n");

  return [
    "Use the retrieved Agno RAG chunks below when they are relevant.",
    options.summaryMode
      ? "The user is asking for a summary or analysis. Produce the best summary possible from these chunks instead of asking for a more specific question."
      : "Ground answers in these chunks. If the chunks do not contain the answer, say what is missing.",
    "Never say you do not have access to the document when RAG chunks are provided.",
    "",
    "Retrieved document chunks:",
    blocks,
  ].join("\n");
}

function formatAttachmentStatus(attachments, storedChunks) {
  if (!attachments.length) return "";

  const storedNames = new Set(storedChunks.map((chunk) => chunk.fileName));
  const blocks = attachments.map((attachment, index) => {
    const header = `[Attachment ${index + 1}] ${attachment.name}\nType: ${attachment.type}\nKind: ${attachment.kind}`;
    if (attachment.text && storedNames.has(attachment.name)) return `${header}\nIndexed into Agno RAG chunks.`;
    if (attachment.text) return `${header}\nText extracted but no chunks were stored.`;
    if (attachment.kind === "image" && attachment.dataUrl) {
      return `${header}\nImage data is attached to the model request when the selected model supports vision.`;
    }
    return `${header}\nNo text could be extracted.`;
  });

  return [
    "Attachment ingestion status:",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

function imagePartsForLlm(attachments) {
  return attachments
    .filter((attachment) => attachment.kind === "image" && attachment.dataUrl)
    .map((attachment) => {
      const match = attachment.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      return {
        name: attachment.name,
        mimeType: match[1],
        data: match[2],
      };
    })
    .filter(Boolean);
}

function buildRagRetrievalQuery(message, attachments) {
  const attachmentSnippets = attachments
    .filter((attachment) => attachment.text)
    .map((attachment) => attachment.text.replace(/\s+/g, " ").split(" ").slice(0, 80).join(" "))
    .join("\n");

  return [message, attachmentSnippets].filter(Boolean).join("\n\n").slice(0, 2400);
}

function buildWebSearchQuery(message, ragChunks, attachments) {
  const ragHints = ragChunks
    .map((chunk) => {
      const snippet = String(chunk.chunkText || chunk.text || "")
        .replace(/\s+/g, " ")
        .split(" ")
        .slice(0, 70)
        .join(" ");
      return `${chunk.fileName}: ${snippet}`;
    })
    .join("\n");

  const imageHints = attachments
    .filter((attachment) => attachment.kind === "image" && !attachment.text)
    .map((attachment) => attachment.name)
    .join(", ");

  const queryParts = [message.trim()];
  if (ragHints) queryParts.push(`Relevant retrieved document chunks:\n${ragHints}`);
  if (imageHints) queryParts.push(`Attached image filenames: ${imageHints}`);

  return queryParts.join("\n\n").slice(0, 1800);
}

async function runTavilySearch(query, options) {
  const response = await withTimeout(
    fetch(tavilySearchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        search_depth: options.searchDepth,
        max_results: 5,
        include_answer: false,
        include_raw_content: options.includeRawContent,
        include_images: false,
      }),
    }),
    8000
  );

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      sources: [],
      error: {
        code: "SEARCH_BAD_RESPONSE",
        message: data?.error || data?.message || `Tavily search failed with ${response.status}`,
      },
    };
  }

  return {
    sources: Array.isArray(data?.results)
      ? data.results.map(normalizeSearchResult).filter((source) => source.url)
      : [],
    error: null,
  };
}

async function searchWeb(query) {
  if (!process.env.TAVILY_API_KEY) {
    return {
      sources: [],
      error: { code: "SEARCH_UNAVAILABLE", message: "Missing TAVILY_API_KEY" },
    };
  }

  try {
    const advancedSearch = await runTavilySearch(query, {
      searchDepth: "advanced",
      includeRawContent: true,
    });

    if (!advancedSearch.error || advancedSearch.sources.length) return advancedSearch;

    const basicSearch = await runTavilySearch(query, {
      searchDepth: "basic",
      includeRawContent: false,
    });

    if (!basicSearch.error || basicSearch.sources.length) return basicSearch;

    return {
      sources: [],
      error: {
        code: basicSearch.error?.code || advancedSearch.error?.code || "SEARCH_UNAVAILABLE",
        message: basicSearch.error?.message || advancedSearch.error?.message || "Tavily search request failed",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tavily search request failed";
    return {
      sources: [],
      error: {
        code: error instanceof Error && error.message === "timeout" ? "SEARCH_TIMEOUT" : "SEARCH_UNAVAILABLE",
        message,
      },
    };
  }
}

async function generateReply(message, model, attachments) {
  const response = await fetch(`${llmServiceUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      model: model || "gemini-2.5-flash",
      timeoutMs: 10000,
      attachments,
    }),
  });

  const data = await response.json();
  if (!response.ok || data?.error) {
    const message = data?.error?.message || "AI pipeline failed";
    return {
      reply: message,
      model: data?.model || model || "unknown",
      usage: data?.usage || {},
      error: data?.error || { code: "LLM_SERVICE_ERROR", message: "LLM service failed" },
    };
  }

  return {
    reply: data.message,
    model: data.model,
    usage: data.usage || {},
    fallbackFrom: data.fallbackFrom,
    fallbackError: data.fallbackError,
    error: null,
  };
}

async function sendMessage(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const { message, chatId, model, webSearch, attachments } = await readJson(req);
  if (!message || !chatId) {
    sendJson(res, 400, { error: "Missing message or chatId" });
    return;
  }

  const normalizedAttachments = await normalizeAttachments(attachments);

  const database = await getDb();
  const threads = database.collection("threads");
  const messages = database.collection("messages");
  const now = new Date();

  await threads.updateOne(
    { chatId, userId },
    {
      $setOnInsert: {
        chatId,
        userId,
        title: "New Chat",
        pinned: false,
        archived: false,
        createdAt: now,
      },
      $set: { updatedAt: now },
    },
    { upsert: true }
  );

  const userMessageResult = await messages.insertOne({
    threadId: chatId,
    userId,
    role: "user",
    content: message,
    attachments: normalizedAttachments.map(publicAttachment),
    createdAt: now,
    updatedAt: now,
  });

  const storedChunks = await storeRagChunks(database, {
    userId,
    threadId: chatId,
    messageId: userMessageResult.insertedId?.toString(),
    attachments: normalizedAttachments,
    createdAt: now,
  });

  const userMessageCount = await messages.countDocuments({
    threadId: chatId,
    userId,
    role: "user",
  });

  if (userMessageCount === 1) {
    await threads.updateOne(
      { chatId, userId },
      { $set: { title: buildAutoTitle(message), updatedAt: new Date() } }
    );
  } else {
    await threads.updateOne(
      { chatId, userId },
      { $set: { updatedAt: new Date() } }
    );
  }

  const ragQuery = buildRagRetrievalQuery(message, normalizedAttachments);
  const summaryMode = isSummaryRequest(message);
  const useWebSearch = typeof webSearch === "boolean" ? webSearch : shouldUseWebSearch(message);
  const useRag = shouldUseRag(message, normalizedAttachments);
  const ragChunks = useRag
    ? await retrieveRagChunks(database, {
        userId,
        threadId: chatId,
        query: ragQuery,
        limit: summaryMode ? 30 : 8,
        summaryMode,
        attachments: normalizedAttachments,
      })
    : [];
  const webSearchQuery = buildWebSearchQuery(message, ragChunks, normalizedAttachments);
  const search = useWebSearch ? await searchWeb(webSearchQuery) : { sources: [], error: null };
  const searchContext = formatSearchContext(search);
  const ragContext = formatRagContext(ragChunks, { summaryMode });
  const attachmentStatus = formatAttachmentStatus(normalizedAttachments, storedChunks);
  const contextBlocks = [searchContext, ragContext, attachmentStatus].filter(Boolean).join("\n\n");
  const taskInstruction = summaryMode
    ? "Task: Summarize the attached/retrieved document clearly. Include the main topic, core sections or ideas, and important details found in the chunks. Do not ask the user for a more specific question."
    : "";
  const llmMessage = contextBlocks
    ? `${contextBlocks}\n\n${taskInstruction ? `${taskInstruction}\n\n` : ""}User question:\n${message}`
    : message;
  const llm = await generateReply(llmMessage, model, imagePartsForLlm(normalizedAttachments));
  const reply = appendSources(llm.reply, search.sources);
  const searchErrorNote =
    useWebSearch && search.error
      ? `Note: Web search was unavailable (${search.error.message}).\n\n`
      : "";
  const assistantContent = `${searchErrorNote}${reply}`;

  await messages.insertOne({
    threadId: chatId,
    userId,
    role: "assistant",
    content: assistantContent,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const thread = await threads.findOne({ chatId, userId });

  sendJson(res, 200, {
    reply: assistantContent,
    model: llm.model,
    usage: llm.usage,
    fallbackFrom: llm.fallbackFrom,
    fallbackError: llm.fallbackError,
    webSearch: Boolean(useWebSearch),
    webSearchMode: typeof webSearch === "boolean" ? "manual" : "auto",
    ragMode: useRag ? "auto" : "off",
    searchSources: search.sources,
    searchError: search.error,
    ragSources: ragChunks.map((chunk) => ({
      fileName: chunk.fileName,
      chunkIndex: chunk.chunkIndex,
      relevance: chunk.relevance,
      vectorScore: chunk.vectorScore,
      framework: chunk.framework,
    })),
    storedRagChunks: storedChunks.length,
    thread: publicDocument(thread),
    error: llm.error,
  });
}

async function listMessages(req, res, url) {
  const userId = getUserId(req);
  if (!userId) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const chatId = url.searchParams.get("chatId");
  if (!chatId) {
    sendJson(res, 200, { messages: [] });
    return;
  }

  const database = await getDb();
  const messages = await database
    .collection("messages")
    .find({ threadId: chatId, userId })
    .sort({ createdAt: 1 })
    .toArray();

  sendJson(res, 200, { messages: messages.map(publicDocument) });
}

async function searchRag(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const { chatId, query, limit } = await readJson(req);
  const cleanedQuery = String(query || "").trim();
  if (!chatId || !cleanedQuery) {
    sendJson(res, 400, { error: "Missing chatId or query" });
    return;
  }

  const database = await getDb();
  const safeLimit = Math.min(Math.max(Number(limit || 8), 1), 20);
  const chunks = await retrieveRagChunks(database, {
    userId,
    threadId: chatId,
    query: cleanedQuery,
    limit: safeLimit,
  });

  sendJson(res, 200, {
    results: chunks.map((chunk) => ({
      id: chunk.id || chunk._id?.toString(),
      fileName: chunk.fileName,
      fileType: chunk.fileType,
      fileSize: chunk.fileSize,
      chunkIndex: chunk.chunkIndex,
      text: chunk.chunkText || chunk.text,
      relevance: chunk.relevance,
      vectorScore: chunk.vectorScore,
      embeddingModel: chunk.embeddingModel,
      createdAt: chunk.createdAt,
    })),
  });
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: serviceName });
    return;
  }

  if (url.pathname === "/" && req.method === "POST") return sendMessage(req, res);
  if (url.pathname === "/rag/search" && req.method === "POST") return searchRag(req, res);
  if (url.pathname === "/message" && req.method === "GET") return listMessages(req, res, url);

  sendJson(res, 404, { error: "Not Found", service: serviceName });
}

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    sendJson(res, error instanceof SyntaxError ? 400 : 500, {
      error: error instanceof SyntaxError ? "Invalid JSON body" : "Internal server error",
      service: serviceName,
    });
  }
});

server.listen(port, () => {
  console.log(`${serviceName} listening on ${port}`);
});
