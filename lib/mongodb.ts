import mongoose from "mongoose";

type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  lastError: Error | null;
  lastErrorAt: number;
};

declare global {
  var mongoose: MongooseCache | undefined;
}

const globalWithMongoose = global as typeof globalThis & {
  mongoose?: MongooseCache;
};

const cached: MongooseCache =
  globalWithMongoose.mongoose ?? {
    conn: null,
    promise: null,
    lastError: null,
    lastErrorAt: 0,
  };

globalWithMongoose.mongoose = cached;

function mongoUri() {
  return process.env.MONGODB_DIRECT_URI || process.env.MONGODB_URI;
}

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function connectToDatabase() {
  if (cached.conn) return cached.conn;

  const uri = mongoUri();
  if (!uri) {
    throw new Error("MONGODB_DIRECT_URI or MONGODB_URI is required");
  }

  const retryAfterMs = Number(process.env.MONGODB_RETRY_AFTER_MS || 10000);
  if (cached.lastError && Date.now() - cached.lastErrorAt < retryAfterMs) {
    throw cached.lastError;
  }

  if (!cached.promise) {
    const serverSelectionTimeoutMS = numberEnv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", 10000);
    const connectTimeoutMS = numberEnv("MONGODB_CONNECT_TIMEOUT_MS", serverSelectionTimeoutMS);
    const socketTimeoutMS = numberEnv("MONGODB_SOCKET_TIMEOUT_MS", 45000);
    const family = Number(process.env.MONGODB_FAMILY || 4);
    cached.promise = mongoose.connect(uri, {
      dbName: process.env.MONGODB_DB,
      serverSelectionTimeoutMS,
      connectTimeoutMS,
      socketTimeoutMS,
      family: family === 6 ? 6 : 4,
    });
  }

  try {
    cached.conn = await cached.promise;
    cached.lastError = null;
    cached.lastErrorAt = 0;
  } catch (error) {
    cached.promise = null;
    cached.lastError = error instanceof Error ? error : new Error("MongoDB connection failed");
    cached.lastErrorAt = Date.now();
    throw error;
  }

  return cached.conn;
}

export function getDatabaseStatus() {
  return {
    connected: Boolean(cached.conn),
    lastError: cached.lastError?.message || null,
    lastErrorAt: cached.lastErrorAt || null,
  };
}
