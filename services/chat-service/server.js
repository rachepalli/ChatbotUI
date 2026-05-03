const http = require("http");
const { MongoClient } = require("mongodb");

const port = Number(process.env.PORT || 4003);
const serviceName = process.env.SERVICE_NAME || "chat-service";
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;
const llmServiceUrl = (process.env.LLM_SERVICE_URL || "http://localhost:4004").replace(/\/$/, "");

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

async function generateReply(message, model) {
  const response = await fetch(`${llmServiceUrl}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      model: model || "gemini-2.5-flash",
      timeoutMs: 10000,
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

  const { message, chatId, model } = await readJson(req);
  if (!message || !chatId) {
    sendJson(res, 400, { error: "Missing message or chatId" });
    return;
  }

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

  await messages.insertOne({
    threadId: chatId,
    userId,
    role: "user",
    content: message,
    createdAt: now,
    updatedAt: now,
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

  const llm = await generateReply(message, model);

  await messages.insertOne({
    threadId: chatId,
    userId,
    role: "assistant",
    content: llm.reply,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const thread = await threads.findOne({ chatId, userId });

  sendJson(res, 200, {
    reply: llm.reply,
    model: llm.model,
    usage: llm.usage,
    fallbackFrom: llm.fallbackFrom,
    fallbackError: llm.fallbackError,
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

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: serviceName });
    return;
  }

  if (url.pathname === "/" && req.method === "POST") return sendMessage(req, res);
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
