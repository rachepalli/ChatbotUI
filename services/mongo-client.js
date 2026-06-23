function mongoUri() {
  return process.env.MONGODB_DIRECT_URI || process.env.MONGODB_URI;
}

function mongoDbName(fallback = "chatbot") {
  return process.env.MONGODB_DB || fallback;
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function mongoClientOptions() {
  const serverSelectionTimeoutMS = numberEnv("MONGODB_SERVER_SELECTION_TIMEOUT_MS", 10000);
  const connectTimeoutMS = numberEnv("MONGODB_CONNECT_TIMEOUT_MS", serverSelectionTimeoutMS);
  const socketTimeoutMS = numberEnv("MONGODB_SOCKET_TIMEOUT_MS", 45000);
  const family = Number(process.env.MONGODB_FAMILY || 4);

  return {
    serverSelectionTimeoutMS,
    connectTimeoutMS,
    socketTimeoutMS,
    family: family === 6 ? 6 : 4,
    retryWrites: true,
  };
}

function redactedMongoUri(uri = mongoUri()) {
  if (!uri) return "";
  return uri.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:<redacted>@");
}

function requiredMongoUri() {
  const uri = mongoUri();
  if (!uri) throw new Error("MONGODB_DIRECT_URI or MONGODB_URI is required");
  return uri;
}

module.exports = {
  mongoClientOptions,
  mongoDbName,
  mongoUri,
  redactedMongoUri,
  requiredMongoUri,
};
