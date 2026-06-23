const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const storePath = path.resolve(__dirname, "..", ".local-data", "chat-store.json");

function defaultStore() {
  return { threads: [], messages: [] };
}

function readStore() {
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      threads: Array.isArray(parsed.threads) ? parsed.threads : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch {
    return defaultStore();
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function normalizeDate(value) {
  if (value instanceof Date) return value.toISOString();
  return value || new Date().toISOString();
}

function sortByUpdatedDesc(items) {
  return items.sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0));
}

function listThreads(userId) {
  return sortByUpdatedDesc(readStore().threads.filter((thread) => thread.userId === userId));
}

function findThread(userId, chatId) {
  return readStore().threads.find((thread) => thread.userId === userId && thread.chatId === chatId) || null;
}

function upsertThread(userId, chatId, updates = {}) {
  const store = readStore();
  const now = normalizeDate(updates.updatedAt);
  let thread = store.threads.find((item) => item.userId === userId && item.chatId === chatId);
  if (!thread) {
    thread = {
      _id: makeId(),
      chatId,
      userId,
      title: "New Chat",
      pinned: false,
      archived: false,
      createdAt: normalizeDate(updates.createdAt),
      updatedAt: now,
    };
    store.threads.push(thread);
  }
  Object.assign(thread, updates, { updatedAt: now });
  writeStore(store);
  return thread;
}

function deleteThread(userId, chatId) {
  const store = readStore();
  const threadCount = store.threads.length;
  store.threads = store.threads.filter((thread) => !(thread.userId === userId && thread.chatId === chatId));
  store.messages = store.messages.filter((message) => !(message.userId === userId && message.threadId === chatId));
  writeStore(store);
  return threadCount - store.threads.length;
}

function insertMessage(message) {
  const store = readStore();
  const record = {
    _id: makeId(),
    ...message,
    createdAt: normalizeDate(message.createdAt),
    updatedAt: normalizeDate(message.updatedAt),
  };
  store.messages.push(record);
  writeStore(store);
  return { insertedId: record._id, message: record };
}

function listMessages(userId, chatId) {
  return readStore()
    .messages.filter((message) => message.userId === userId && message.threadId === chatId)
    .sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0));
}

function listUserMessages(userId) {
  return readStore()
    .messages.filter((message) => message.userId === userId)
    .sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0));
}

function countUserMessages(userId, chatId) {
  return readStore().messages.filter(
    (message) => message.userId === userId && message.threadId === chatId && message.role === "user"
  ).length;
}

module.exports = {
  countUserMessages,
  deleteThread,
  findThread,
  insertMessage,
  listMessages,
  listThreads,
  listUserMessages,
  upsertThread,
};
