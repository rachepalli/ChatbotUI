const http = require("http");
const { MongoClient } = require("mongodb");

const port = Number(process.env.PORT || 4002);
const serviceName = process.env.SERVICE_NAME || "thread-service";
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB;

let mongoClient;
let threadsCollection;

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

async function getThreadsCollection() {
  if (!mongoUri) throw new Error("MONGODB_URI is required");

  if (!mongoClient) {
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    threadsCollection = mongoClient.db(dbName).collection("threads");
    await threadsCollection.createIndex({ chatId: 1, userId: 1 }, { unique: true });
  }

  return threadsCollection;
}

function getUserId(req) {
  const userId = req.headers["x-user-id"];
  return typeof userId === "string" && userId.trim() ? userId.trim() : "";
}

function publicThread(thread) {
  if (!thread) return null;
  return {
    ...thread,
    _id: thread._id?.toString(),
  };
}

async function listThreads(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const threads = await getThreadsCollection();
  const items = await threads.find({ userId }).sort({ updatedAt: -1 }).toArray();
  sendJson(res, 200, { threads: items.map(publicThread) });
}

async function createThread(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const { chatId, title } = await readJson(req);
  if (!chatId || typeof chatId !== "string") {
    sendJson(res, 400, { error: "chatId is required" });
    return;
  }

  const now = new Date();
  const threads = await getThreadsCollection();
  await threads.updateOne(
    { chatId, userId },
    {
      $setOnInsert: {
        chatId,
        userId,
        pinned: false,
        archived: false,
        createdAt: now,
      },
      $set: {
        title: title || "New Chat",
        updatedAt: now,
      },
    },
    { upsert: true }
  );

  const thread = await threads.findOne({ chatId, userId });
  sendJson(res, 201, { thread: publicThread(thread) });
}

async function updateThread(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const { chatId, title, pinned, archived } = await readJson(req);
  if (!chatId || typeof chatId !== "string") {
    sendJson(res, 400, { error: "chatId is required" });
    return;
  }

  const updates = { updatedAt: new Date() };
  if (title !== undefined) updates.title = title;
  if (pinned !== undefined) updates.pinned = Boolean(pinned);
  if (archived !== undefined) updates.archived = Boolean(archived);

  const threads = await getThreadsCollection();
  const result = await threads.findOneAndUpdate(
    { chatId, userId },
    { $set: updates },
    { returnDocument: "after" }
  );

  sendJson(res, 200, { thread: publicThread(result) });
}

async function deleteThread(req, res) {
  const userId = getUserId(req);
  if (!userId) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const { chatId } = await readJson(req);
  if (!chatId || typeof chatId !== "string") {
    sendJson(res, 400, { error: "chatId is required" });
    return;
  }

  const threads = await getThreadsCollection();
  const result = await threads.deleteOne({ chatId, userId });
  sendJson(res, 200, { success: true, deleted: result.deletedCount });
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: serviceName });
    return;
  }

  if (url.pathname === "/" && req.method === "GET") return listThreads(req, res);
  if (url.pathname === "/" && req.method === "POST") return createThread(req, res);
  if (url.pathname === "/" && req.method === "PUT") return updateThread(req, res);
  if (url.pathname === "/" && req.method === "DELETE") return deleteThread(req, res);

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
