const http = require("http");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");
const zlib = require("zlib");
const localStore = require("../local-chat-store");
const { mongoClientOptions, mongoDbName, requiredMongoUri } = require("../mongo-client");

let mammoth = null;
try {
  mammoth = require("mammoth");
} catch {
  mammoth = null;
}

const port = Number(process.env.PORT || 4003);
const serviceName = process.env.SERVICE_NAME || "chat-service";
const dbName = mongoDbName();
const llmServiceUrl = (process.env.LLM_SERVICE_URL || "http://localhost:4004").replace(/\/$/, "");
const ragServiceUrl = (process.env.RAG_SERVICE_URL || "http://localhost:4005").replace(/\/$/, "");
const tavilySearchUrl = "https://api.tavily.com/search";
const ragSummaryLimit = Number(process.env.RAG_SUMMARY_MAX_CHUNKS || 24);
const imageUploadDailyLimit = Number(process.env.CHAT_IMAGE_UPLOAD_DAILY_LIMIT || 5);
const documentUploadDailyLimit = Number(process.env.CHAT_DOCUMENT_UPLOAD_DAILY_LIMIT || 3);
const uploadMaxBytes = Number(process.env.CHAT_UPLOAD_MAX_BYTES || 50 * 1024 * 1024);

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
  const uri = requiredMongoUri();

  if (!mongoClient) {
    mongoClient = new MongoClient(uri, mongoClientOptions());
    try {
      await mongoClient.connect();
      db = mongoClient.db(dbName);
      await db.collection("threads").createIndex({ chatId: 1, userId: 1 }, { unique: true });
      await db.collection("messages").createIndex({ threadId: 1, userId: 1, createdAt: 1 });
    } catch (error) {
      await mongoClient.close().catch(() => {});
      mongoClient = undefined;
      db = undefined;
      throw error;
    }
  }

  if (!db) throw new Error("MongoDB connection is not ready");
  return db;
}

function isDatabaseUnavailable(error) {
  const message = String(error?.message || error || "");
  return (
    error?.name === "MongoServerSelectionError" ||
    error?.name === "MongoNetworkError" ||
    message.includes("MONGODB_DIRECT_URI") ||
    message.includes("MONGODB_URI") ||
    message.includes("MongoDB connection is not ready") ||
    message.includes("SSL routines") ||
    message.includes("tlsv1 alert") ||
    message.includes("Could not connect to any servers") ||
    message.includes("querySrv") ||
    message.includes("ECONNREFUSED")
  );
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

function compactConversationText(value, maxLength = 900) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function roleLabel(role) {
  return role === "assistant" ? "Assistant" : "User";
}

function assistantBehaviorInstructions() {
  return [
    "Assistant behavior:",
    "You are an intelligent, helpful, knowledgeable AI assistant for programming, technology, and general questions.",
    "Respond naturally and conversationally, with a polished style similar to modern assistants such as ChatGPT, Gemini, Copilot, or Grok.",
    "Treat this chat as one continuous conversation. Use the previous conversation to understand follow-up requests.",
    "When the user says things like explain in detail, more details, elaborate, deeper, in depth, continue, or tell me more, assume they mean the previous topic and expand it directly.",
    "Never ask for clarification when the previous topic makes the follow-up clear.",
    "If the user clearly changes topic with a standalone question, answer the new topic smoothly.",
    "Use clear headings, bullets, examples, analogies, and code blocks when helpful.",
    "For technical topics, include practical insights and concise examples.",
    "Python handling: if the user first asks what Python is, give a concise friendly introduction. If a later follow-up asks for more detail, expand on Python with history, features, syntax basics, use cases, ecosystem, advantages, disadvantages, and practical examples.",
  ].join("\n");
}

function formatConversationHistory(history) {
  const lines = history
    .filter((item) => item?.content)
    .map((item) => `${roleLabel(item.role)}: ${compactConversationText(item.content)}`);

  if (!lines.length) return "";

  return [
    "Previous conversation in this chat, oldest to newest:",
    lines.join("\n"),
    "",
    "Use this context to understand follow-up questions. If the user says things like it, that, this topic, same, explain more, or asks a short related question, infer the subject from the previous conversation and answer directly. Ask for clarification only when the previous conversation truly does not identify the subject.",
    "If the current user question is a standalone general question or clearly starts a new topic, answer it directly on its own. Do not force it to relate to the previous conversation.",
  ].join("\n");
}

function buildContextualPrompt(message, conversationContext) {
  return [
    assistantBehaviorInstructions(),
    conversationContext ? "" : null,
    conversationContext,
    "",
    "Current user question:",
    message,
  ]
    .filter((item) => item !== null && item !== undefined && item !== "")
    .join("\n");
}

function isDocumentAttachment(attachment) {
  if (attachment.kind === "image") return false;
  if (attachment.kind === "document") return true;

  const type = String(attachment.type || "").toLowerCase();
  const name = String(attachment.name || "").toLowerCase();
  return (
    type === "application/pdf" ||
    type.includes("wordprocessingml") ||
    name.endsWith(".pdf") ||
    name.endsWith(".docx")
  );
}

function hasImageAttachments(attachments) {
  return attachments.some((attachment) => attachment.kind === "image" && attachment.dataUrl);
}

function buildImageAwarePrompt(message, conversationContext, attachments) {
  const base = buildContextualPrompt(message, conversationContext);
  if (!hasImageAttachments(attachments)) return base;

  const imageNames = attachments
    .filter((attachment) => attachment.kind === "image")
    .map((attachment) => attachment.name)
    .join(", ");

  return [
    base,
    "",
    "One or more images are attached to this message.",
    imageNames ? `Image file(s): ${imageNames}.` : null,
    "Analyze the attached image(s) directly. Describe visible content, readable text, objects, context, and answer the user's question based on what you see in the image(s).",
  ]
    .filter((item) => item !== null && item !== undefined && item !== "")
    .join("\n");
}

function buildContextualQuery(message, history) {
  const recentUserContext = history
    .filter((item) => item?.role === "user" && item?.content)
    .slice(-6)
    .map((item) => compactConversationText(item.content, 300))
    .join("\n");

  return [recentUserContext ? `Recent related user questions:\n${recentUserContext}` : "", `Current question:\n${message}`]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2400);
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

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function validateAttachmentSizes(attachments) {
  if (!Array.isArray(attachments)) return;

  const oversized = attachments.find((attachment) => {
    const size = Number(attachment?.size || 0);
    return Number.isFinite(size) && size > uploadMaxBytes;
  });

  if (oversized) {
    const error = new Error(`${String(oversized?.name || "Attachment")} is larger than the 50 MB attachment limit.`);
    error.status = 400;
    throw error;
  }
}

function isImageUploadAttachment(attachment) {
  const type = String(attachment?.type || "").toLowerCase();
  const kind = String(attachment?.kind || "").toLowerCase();

  return kind === "image" || type.startsWith("image/");
}

function isDocumentUploadAttachment(attachment) {
  if (isImageUploadAttachment(attachment)) return false;

  const type = String(attachment?.type || "").toLowerCase();
  const name = String(attachment?.name || "").toLowerCase();
  const kind = String(attachment?.kind || "").toLowerCase();

  return (
    kind === "document" ||
    type === "application/pdf" ||
    name.endsWith(".pdf") ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx") ||
    type === "application/msword" ||
    name.endsWith(".doc")
  );
}

function countUploadAttachments(items, kind) {
  if (!Array.isArray(items)) return 0;
  const matcher = kind === "image" ? isImageUploadAttachment : isDocumentUploadAttachment;
  return items.filter(matcher).length;
}

async function countDailyImageUploads({ messages, userId, since }) {
  if (!messages) {
    return localStore
      .listUserMessages(userId)
      .filter((message) => message.role === "user" && new Date(message.createdAt) >= since)
      .reduce((total, message) => total + countUploadAttachments(message.attachments, "image"), 0);
  }

  const rows = await messages
    .find(
      {
        userId,
        role: "user",
        createdAt: { $gte: since },
        attachments: { $exists: true, $ne: [] },
      },
      { projection: { attachments: 1 } }
    )
    .toArray();

  return rows.reduce((total, message) => total + countUploadAttachments(message.attachments, "image"), 0);
}

async function countDailyDocumentUploads({ messages, userId, since }) {
  if (!messages) {
    return localStore
      .listUserMessages(userId)
      .filter((message) => message.role === "user" && new Date(message.createdAt) >= since)
      .reduce((total, message) => total + countUploadAttachments(message.attachments, "document"), 0);
  }

  const rows = await messages
    .find(
      {
        userId,
        role: "user",
        createdAt: { $gte: since },
        attachments: { $exists: true, $ne: [] },
      },
      { projection: { attachments: 1 } }
    )
    .toArray();

  return rows.reduce((total, message) => total + countUploadAttachments(message.attachments, "document"), 0);
}

async function enforceUploadLimits({ attachments, messages, userId, now }) {
  validateAttachmentSizes(attachments);

  const since = startOfUtcDay(now);
  const imageCount = countUploadAttachments(attachments, "image");
  const documentCount = countUploadAttachments(attachments, "document");

  if (imageCount) {
    const currentImageCount = await countDailyImageUploads({ messages, userId, since });
    if (currentImageCount + imageCount > imageUploadDailyLimit) {
      const error = new Error(`You can upload up to ${imageUploadDailyLimit} images per day.`);
      error.status = 429;
      throw error;
    }
  }

  if (documentCount) {
    const currentDocumentCount = await countDailyDocumentUploads({ messages, userId, since });
    if (currentDocumentCount + documentCount > documentUploadDailyLimit) {
      const error = new Error(`You can upload up to ${documentUploadDailyLimit} documents per day.`);
      error.status = 429;
      throw error;
    }
  }
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
  const text = String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    .replace(/\ufffd/g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return text
    .split(/\n{2,}|(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(isReadableExtractedSegment)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .slice(0, 24000)
    .trim();
}

function isReadableExtractedSegment(segment) {
  const text = String(segment || "").trim();
  if (!text) return false;
  const words = text.match(/[A-Za-z][A-Za-z-]{2,}/g) || [];
  const wordChars = words.join("").length;
  if (text.length < 80) return words.length >= 4 && wordChars / text.length >= 0.32;

  const symbolChars = (text.match(/[^A-Za-z0-9\s.,;:!?'"()[\]{}\/\\\-+*&%#=@<>|`~^]/g) || []).length;
  const repeatedTinyTokens = (text.match(/\b([A-Za-z]{1,2})\b(?:\s+\1\b){4,}/g) || []).length;

  return words.length >= 8 && wordChars / text.length >= 0.28 && symbolChars / text.length <= 0.03 && repeatedTinyTokens === 0;
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
  const buffer = Buffer.from(bytes);
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    let text = "";
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      text += String.fromCharCode(buffer.readUInt16BE(index));
    }
    return text;
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    let text = "";
    for (let index = 2; index + 1 < buffer.length; index += 2) {
      text += String.fromCharCode(buffer.readUInt16LE(index));
    }
    return text;
  }
  return buffer.toString("utf8").replace(/\u0000/g, "");
}

function extractPdfTextFromContent(content) {
  const text = [];
  const textBlocks = content.match(/BT[\s\S]*?ET/g) || [content];
  const literalPattern = /\((?:\\.|[^\\)])*\)/g;
  const hexPattern = /<([0-9a-fA-F\s]{4,})>/g;
  let match;

  for (const block of textBlocks) {
    if (!/(Tj|TJ|'|")/.test(block)) continue;
    while ((match = literalPattern.exec(block))) {
      text.push(decodePdfLiteralString(match[0].slice(1, -1)));
    }
    while ((match = hexPattern.exec(block))) {
      text.push(decodePdfHexString(match[1]));
    }
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
        try {
          streams.push(zlib.inflateRawSync(streamBytes).toString("latin1"));
        } catch {
          streams.push(match[2]);
        }
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
      return "";
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
  } catch (error) {
    console.warn(`[${serviceName}] RAG ingest failed: ${error instanceof Error ? error.message : String(error)}`);
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
  } catch (error) {
    console.warn(`[${serviceName}] RAG search failed: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function threadHasRagDocuments({ userId, threadId }) {
  try {
    const data = await callRagService(
      "/status",
      {
        userId,
        threadId,
      },
      8000
    );
    return Boolean(data.hasDocuments);
  } catch (error) {
    console.warn(`[${serviceName}] RAG status failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

function historyHasDocumentAttachment(history) {
  return history.some((item) => {
    const attachments = Array.isArray(item?.attachments) ? item.attachments : [];
    return attachments.some((attachment) => {
      const type = String(attachment?.type || "").toLowerCase();
      const kind = String(attachment?.kind || "").toLowerCase();
      return kind === "document" || type === "application/pdf" || type.includes("wordprocessingml") || type.startsWith("text/");
    });
  });
}

async function answerWithAgnoRag(_database, { userId, threadId, message, query, model, limit = 8, summaryMode = false, attachments = [], createdAt }) {
  const ingestableAttachments = attachments
    .filter((attachment) => attachment.text)
    .map((attachment) => ({
      name: attachment.name,
      type: attachment.type,
      size: attachment.size,
      text: attachment.text,
      attachmentId: attachmentId(attachment),
    }));

  const data = await callRagService(
    "/answer",
    {
      userId,
      threadId,
      message,
      query,
      model,
      limit,
      summaryMode,
      detailMode: isDetailedRequest(message),
      attachments: ingestableAttachments,
      createdAt,
    },
    60000
  );

  return {
    reply: String(data.reply || ""),
    model: data.model || model || "unknown",
    usage: data.usage || {},
    sources: Array.isArray(data.sources) ? data.sources : [],
    storedChunks: Number(data.storedChunks || 0),
    error: data.error || null,
  };
}

function isSummaryRequest(message) {
  return /\b(summarize|summary|overview|brief|key\s+points|main\s+points)\b/i.test(
    String(message || "")
  );
}

function isDetailedRequest(message) {
  return /\b(explain\s+in\s+detail|detail(?:ed)?\s+explain|explain\s+deeply|in\s+detail|detailed\s+explanation|elaborate|in\s+depth|deep\s+dive|more\s+detail|more\s+details)\b/i.test(
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
  const documentAttachments = attachments.filter(isDocumentAttachment);
  if (documentAttachments.some((attachment) => attachment.text)) return true;
  if (documentAttachments.length) return true;

  const imageOnly =
    attachments.length > 0 && attachments.every((attachment) => attachment.kind === "image");
  if (imageOnly) return false;

  return /\b(document|documents|file|files|attachment|attached|pdf|docx|chunk|chunks|uploaded|based on|according to)\b/i.test(
    String(message || "")
  );
}

function isLikelyRagFollowup(message) {
  const value = String(message || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!value) return false;
  if (/\b(this|that|it|its|above|previous|same|these|those)\b/.test(value)) return true;
  if (/\b(summary|summarize|overview|brief|key points|main points|main topic|important details|notes|explain|explanation|describe|elaborate|detail|detailed|in depth|deep dive)\b/.test(value)) {
    return true;
  }
  if (/\b(in|from|according to|based on)\s+(the\s+)?(document|file|pdf|attachment|notes)\b/.test(value)) return true;
  if (
    /^(what|which|how|why|when|where)\b/.test(value) &&
    /\b(topic|point|points|section|chapter|table|figure|difference|compare|advantages|features|steps|process|definition|marker|term|keyword|item|value|name|date|fact)\b/.test(value)
  ) {
    return true;
  }
  return false;
}

function formatRagContext(chunks, options = {}) {
  if (!chunks.length) return "";

  const maxChunks = options.summaryMode || options.detailMode ? ragSummaryLimit : 6;
  const maxChars = 1400;
  const sourceChars = chunks.reduce((total, chunk) => total + String(chunk.chunkText || chunk.text || "").length, 0);
  const summaryLengthInstruction =
    sourceChars < 2500
      ? "Keep the summary short: one brief overview paragraph and 3 to 5 bullets."
      : sourceChars < 9000
        ? "Use a medium-length summary: a short overview plus concise bullets for the main topics."
        : "Use a longer summary only because the document is long: cover all major topics with concise sections.";
  const blocks = chunks
    .slice(0, maxChunks)
    .map((chunk, index) => {
      return `[Source ${index + 1}] ${chunk.fileName} part ${chunk.chunkIndex + 1}\n${String(chunk.chunkText || chunk.text || "").slice(0, maxChars)}`;
    })
    .join("\n\n");

  return [
    "Use the uploaded document source material below when it is relevant.",
    options.summaryMode
      ? `You are an intelligent document analysis assistant. The user is asking for a full-document summary or analysis. ${summaryLengthInstruction} First infer the complete document structure: title, chapters, headings, subheadings, sections, tables, important concepts, and all major topics. Cover every major topic, section, workflow, list, definition, and important fact present in this source material, but do not over-explain small documents. Generate a structured section-by-section summary, not a raw chunk dump. Use Markdown bold for topic headings, section headings, subheadings, and short bullet lead-ins. Do not bold full body sentences. Keep body text plain, concise, and easy to scan. Prefer paraphrasing over copying. Use only facts explicitly present in this source material. Do not mention chunks, retrieval, RAG, source numbers, missing-information sections, limitation sections, recommendation sections, critique sections, or filler endings like no additional information is available unless the user asks for them.`
      : options.detailMode
        ? "You are an intelligent document analysis assistant. The user is asking for a detailed explanation. Explain the current document/topic deeply using the uploaded document source material. If the request refers broadly to it, this document, everything, or the previous document, explain all major sections in depth. If the request names a specific heading, topic, concept, or chapter, explain only that topic deeply. Cover definitions, concepts, workflows, features, examples, benefits, limitations, tables, and important facts when they are present in the document. Rewrite content in simpler and clearer language. Use Markdown bold for topic headings, section headings, subheadings, and short bullet lead-ins. Do not bold full body sentences. Never dump retrieved chunks, repeat OCR text, or copy paragraphs directly. Do not mention chunks, retrieval, RAG, or source numbers."
        : "Write a polished ChatGPT-style response grounded in this source material. Use Markdown bold for headings, subheadings, and short bullet lead-ins when the answer has multiple points. If the user asks about a specific heading, topic, concept, or chapter, explain only that topic deeply and avoid summarizing the entire document. Synthesize related source material instead of copying raw paragraphs or dumping retrieved chunks. Match the user's requested depth. If the source material does not contain the answer, say what is missing.",
    "Never say you do not have access to the document when source material is provided.",
    "",
    "Uploaded document source material:",
    blocks,
  ].join("\n");
}

function uniqueRagSources(chunks) {
  const seen = new Set();
  const sources = [];
  for (const chunk of chunks) {
    const key = [
      chunk.fileName || "Uploaded document",
      Number.isFinite(chunk.chunkIndex) ? chunk.chunkIndex : sources.length,
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(chunk);
  }
  return sources;
}

function cleanRagAssistantContent(reply, error, chunks, message) {
  const text = String(reply || "").trim();
  if (!error) return text;
  return text || "I found relevant uploaded document content, but the summary generation step is temporarily unavailable. Please try again.";
}

function extractiveRagReply(message, chunks) {
  return chunks.length
    ? "I found relevant uploaded document content, but the summary generation step is temporarily unavailable. Please try again."
    : "I could not find relevant uploaded document content for that question.";
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
  try {
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
      options.timeoutMs || 12000
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
      timeoutMs: 12000,
    });

    if (!advancedSearch.error || advancedSearch.sources.length) return advancedSearch;

    const basicSearch = await runTavilySearch(query, {
      searchDepth: "basic",
      includeRawContent: false,
      timeoutMs: 12000,
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
  const imageAttachments = Array.isArray(attachments) ? attachments : [];
  const timeoutMs = imageAttachments.length ? 45000 : 10000;
  const response = await fetch(`${llmServiceUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      model: model || "gemini-2.5-flash",
      timeoutMs,
      attachments: imageAttachments,
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

  const now = new Date();
  let database = null;
  let threads = null;
  let messages = null;
  let databaseError = null;
  let previousMessages = [];

  try {
    database = await getDb();
    threads = database.collection("threads");
    messages = database.collection("messages");
    previousMessages = await messages
      .find({ threadId: chatId, userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    databaseError = error;
    console.warn(`[${serviceName}] database unavailable; continuing chat without persistence: ${error.message}`);
    previousMessages = localStore.listMessages(userId, chatId).slice(-20);
  }

  await enforceUploadLimits({ attachments, messages, userId, now });
  const normalizedAttachments = await normalizeAttachments(attachments);

  const conversationHistory = previousMessages.reverse();
  const conversationContext = formatConversationHistory(conversationHistory);
  const contextualQuery = buildContextualQuery(message, conversationHistory);

  if (threads) {
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
  } else if (databaseError) {
    localStore.upsertThread(userId, chatId, {
      title: "New Chat",
      pinned: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
  }

  const userMessageResult = messages
    ? await messages.insertOne({
        threadId: chatId,
        userId,
        role: "user",
        content: message,
        attachments: normalizedAttachments.map(publicAttachment),
        createdAt: now,
        updatedAt: now,
      })
    : localStore.insertMessage({
        threadId: chatId,
        userId,
        role: "user",
        content: message,
        attachments: normalizedAttachments.map(publicAttachment),
        createdAt: now,
        updatedAt: now,
      });

  const userMessageCount = messages
    ? await messages.countDocuments({
        threadId: chatId,
        userId,
        role: "user",
      })
    : localStore.countUserMessages(userId, chatId);

  if (threads && userMessageCount === 1) {
    await threads.updateOne(
      { chatId, userId },
      { $set: { title: buildAutoTitle(message), updatedAt: new Date() } }
    );
  } else if (threads) {
    await threads.updateOne(
      { chatId, userId },
      { $set: { updatedAt: new Date() } }
    );
  } else if (databaseError && userMessageCount === 1) {
    localStore.upsertThread(userId, chatId, { title: buildAutoTitle(message), updatedAt: new Date() });
  } else if (databaseError) {
    localStore.upsertThread(userId, chatId, { updatedAt: new Date() });
  }

  const ragQuery = buildRagRetrievalQuery(contextualQuery, normalizedAttachments);
  const detailMode = isDetailedRequest(message);
  const summaryMode = isSummaryRequest(message) && !detailMode;
  const useWebSearch = typeof webSearch === "boolean" ? webSearch : shouldUseWebSearch(message);
  const hasDocumentHistory = historyHasDocumentAttachment(conversationHistory);
  const explicitRagRequest = shouldUseRag(message, normalizedAttachments);
  const likelyRagFollowup = isLikelyRagFollowup(message);
  const hasExistingRagDocuments =
    likelyRagFollowup && !normalizedAttachments.length
      ? hasDocumentHistory || (await threadHasRagDocuments({ userId, threadId: chatId }))
      : false;
  const useRag = explicitRagRequest || (hasExistingRagDocuments && likelyRagFollowup);
  let storedChunks = [];
  let ragChunks = [];
  let search = { sources: [], error: null };
  let llm;
  let assistantContent;

  if (useRag) {
    try {
      const ragAnswer = await answerWithAgnoRag(database, {
        userId,
        threadId: chatId,
        message,
        query: ragQuery,
        model,
        limit: summaryMode || detailMode ? ragSummaryLimit : 8,
        summaryMode,
        attachments: normalizedAttachments,
        createdAt: now,
      });
      ragChunks = ragAnswer.sources;
      storedChunks = Array.from({ length: ragAnswer.storedChunks }, (_, index) => ({ fileName: `chunk-${index}` }));
      llm = {
        reply: ragAnswer.reply,
        model: ragAnswer.model,
        usage: ragAnswer.usage,
        fallbackFrom: undefined,
        fallbackError: undefined,
        error: ragAnswer.error,
      };
      assistantContent = cleanRagAssistantContent(ragAnswer.reply, ragAnswer.error, ragChunks, message);
    } catch (error) {
      console.warn(`[${serviceName}] Agno RAG answer failed: ${error instanceof Error ? error.message : String(error)}`);
      storedChunks = await storeRagChunks(database, {
        userId,
        threadId: chatId,
        messageId: userMessageResult.insertedId?.toString(),
        attachments: normalizedAttachments,
        createdAt: now,
      });
      ragChunks = await retrieveRagChunks(database, {
        userId,
        threadId: chatId,
        query: ragQuery,
        limit: summaryMode || detailMode ? ragSummaryLimit : 8,
        summaryMode,
        attachments: normalizedAttachments,
      });
      const ragContext = formatRagContext(ragChunks, { summaryMode, detailMode });
      const attachmentStatus = formatAttachmentStatus(normalizedAttachments, storedChunks);
      const contextBlocks = [ragContext, attachmentStatus].filter(Boolean).join("\n\n");
      const taskInstruction = summaryMode
        ? "Task: Summarize the complete attached/retrieved document as a polished ChatGPT-style answer. Infer the document hierarchy and cover all major headings/topics specified in the document section-by-section. Bold headings, subheadings, and short bullet lead-ins. Keep the length proportional to the document size. Do not dump chunks or copy OCR text. Do not ask the user for a more specific question. Do not mention chunks, retrieval, RAG, source numbers, missing-information sections, limitation sections, recommendation sections, critique sections, or filler endings like no additional information is available unless the user asks for them."
        : detailMode
          ? "Task: Give a detailed explanation of the current uploaded document/topic. If the user refers broadly to it or the previous document, explain all major sections in depth. If the user names a specific topic, explain only that topic. Bold headings, subheadings, and short bullet lead-ins. Expand the concepts, definitions, workflows, features, examples, and important facts found in the source material. Do not dump chunks or copy OCR text. Do not ask the user to repeat the document or topic when the previous context is clear."
          : "";
      const llmMessage = contextBlocks
        ? `${contextBlocks}\n\n${taskInstruction ? `${taskInstruction}\n\n` : ""}${message}`
        : message;
      llm = await generateReply(llmMessage, model, imagePartsForLlm(normalizedAttachments));
      assistantContent = llm.error
        ? "I found relevant uploaded document content, but the summary generation step is temporarily unavailable. Please try again."
        : llm.reply;
    }
  } else {
    const webSearchQuery = buildWebSearchQuery(contextualQuery, ragChunks, normalizedAttachments);
    search = useWebSearch ? await searchWeb(webSearchQuery) : { sources: [], error: null };
    const searchContext = formatSearchContext(search);
    const contextBlocks = [searchContext].filter(Boolean).join("\n\n");
    const imageAwarePrompt = buildImageAwarePrompt(message, conversationContext, normalizedAttachments);
    const llmMessage = contextBlocks ? `${contextBlocks}\n\n${imageAwarePrompt}` : imageAwarePrompt;
    llm = await generateReply(llmMessage, model, imagePartsForLlm(normalizedAttachments));
    const reply = appendSources(llm.reply, search.sources);
    const searchErrorNote =
      useWebSearch && search.error
        ? `Note: Web search was unavailable (${search.error.message}).\n\n`
        : "";
    assistantContent = `${searchErrorNote}${reply}`;
  }

  if (messages) {
    await messages.insertOne({
      threadId: chatId,
      userId,
      role: "assistant",
      content: assistantContent,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  } else if (databaseError) {
    localStore.insertMessage({
      threadId: chatId,
      userId,
      role: "assistant",
      content: assistantContent,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const thread = threads ? await threads.findOne({ chatId, userId }) : localStore.findThread(userId, chatId);
  const persistenceError = databaseError
    ? {
        code: "DATABASE_UNAVAILABLE",
        message: "MongoDB is unavailable, so this chat was saved to local development history.",
      }
    : null;

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
    ragSources: uniqueRagSources(ragChunks).map((chunk) => ({
      fileName: chunk.fileName,
      chunkIndex: chunk.chunkIndex,
      relevance: chunk.relevance,
      vectorScore: chunk.vectorScore,
      framework: chunk.framework,
    })),
    storedRagChunks: storedChunks.length,
    thread: publicDocument(thread),
    error: llm.error || persistenceError,
    persistenceError,
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

  try {
    const database = await getDb();
    const messages = await database
      .collection("messages")
      .find({ threadId: chatId, userId })
      .sort({ createdAt: 1 })
      .toArray();

    sendJson(res, 200, { messages: messages.map(publicDocument) });
  } catch (error) {
    if (!isDatabaseUnavailable(error)) throw error;
    console.warn(`[${serviceName}] message history unavailable: ${error.message}`);
    sendJson(res, 200, {
      messages: localStore.listMessages(userId, chatId).map(publicDocument),
      error: {
        code: "DATABASE_UNAVAILABLE",
        message: "Using local development chat history because MongoDB is unavailable.",
      },
    });
  }
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

  const safeLimit = Math.min(Math.max(Number(limit || 8), 1), 20);
  const chunks = await retrieveRagChunks(null, {
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
    console.error(`[${serviceName}] ${req.method} ${req.url} failed:`, error);
    if (isDatabaseUnavailable(error)) {
      sendJson(res, 503, {
        error: "Database unavailable",
        message: "Chat storage is temporarily unavailable. Check MongoDB Atlas network access or use a local MongoDB URI.",
        service: serviceName,
      });
      return;
    }
    const status = error instanceof SyntaxError ? 400 : Number(error?.status || 500);
    sendJson(res, status, {
      error:
        error instanceof SyntaxError
          ? "Invalid JSON body"
          : status === 429
            ? "Upload limit reached"
            : status === 400
              ? "Upload rejected"
              : "Internal server error",
      message: error instanceof Error ? error.message : String(error),
      service: serviceName,
    });
  }
});

server.listen(port, () => {
  console.log(`${serviceName} listening on ${port}`);
});
