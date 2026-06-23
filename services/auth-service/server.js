const crypto = require("crypto");
const http = require("http");
const { MongoClient } = require("mongodb");
const bcrypt = require("bcryptjs");
const nodemailer = require("nodemailer");
const { mongoClientOptions, mongoDbName, requiredMongoUri } = require("../mongo-client");

const port = Number(process.env.PORT || 4001);
const serviceName = process.env.SERVICE_NAME || "auth-service";
const dbName = mongoDbName();
const resetTokenTtlMs = 15 * 60 * 1000;

let mongoClient;
let usersCollection;

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const error = new Error("Request body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function getUsersCollection() {
  const uri = requiredMongoUri();

  if (!mongoClient) {
    mongoClient = new MongoClient(uri, mongoClientOptions());
    await mongoClient.connect();
    usersCollection = mongoClient.db(dbName).collection("users");
    await usersCollection.createIndex({ email: 1 }, { unique: true });
  }

  return usersCollection;
}

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const host = String(process.env.SMTP_HOST || "").trim();
  const mailPort = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587;
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const fromCandidate = String(process.env.SMTP_FROM || "").trim();
  const placeholderValues = new Set([
    "your-email@gmail.com",
    "your_from_email",
    "your-16-char-app-password",
    "your_smtp_password",
  ]);
  const from =
    !fromCandidate || placeholderValues.has(fromCandidate) ? user : fromCandidate;
  const isDevelopment = process.env.NODE_ENV === "development";
  const isConfigured = Boolean(host && user && pass && from && !placeholderValues.has(pass));

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Reset your password</h2>
      <p>We received a request to reset your password.</p>
      <p>Click the link below to set a new password. This link will expire in 15 minutes.</p>
      <p><a href="${resetUrl}" target="_blank" rel="noopener noreferrer">Reset Password</a></p>
      <p>If you did not request this, you can safely ignore this email.</p>
    </div>
  `;

  if (!isConfigured) {
    console.warn(
      "[PASSWORD RESET] SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM."
    );
    console.log(`[PASSWORD RESET] Email to ${to}: ${resetUrl}`);
    return isDevelopment ? { sent: false, devResetUrl: resetUrl } : { sent: false };
  }

  const transporter = nodemailer.createTransport({
    host,
    port: mailPort,
    secure: mailPort === 465,
    auth: { user, pass },
    ...(mailPort === 587 ? { requireTLS: true } : {}),
  });

  try {
    await transporter.sendMail({
      from,
      to,
      subject: "Reset your password",
      html,
    });
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to send reset email";
    console.error("[PASSWORD RESET] SMTP send failed:", message);
    return isDevelopment
      ? { sent: false, devResetUrl: resetUrl, error: message }
      : { sent: false, error: message };
  }
}

async function signup(req, res) {
  const { name, email, password } = await readJson(req);
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail || !password || typeof password !== "string") {
    sendJson(res, 400, { error: "Email and password required" });
    return;
  }

  const users = await getUsersCollection();
  const existing = await users.findOne({ email: normalizedEmail });

  if (existing) {
    sendJson(res, 400, { error: "User already exists" });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const now = new Date();

  await users.insertOne({
    name: typeof name === "string" && name.trim() ? name.trim() : "User",
    email: normalizedEmail,
    password: hash,
    image: "",
    providers: ["credentials"],
    hasOnboarded: false,
    createdAt: now,
    updatedAt: now,
  });

  sendJson(res, 201, { success: true });
}

async function forgotPassword(req, res) {
  const { email } = await readJson(req);
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    sendJson(res, 400, { error: "Valid email is required" });
    return;
  }

  const users = await getUsersCollection();
  const user = await users.findOne({ email: normalizedEmail });

  if (user) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    const resetPasswordExpires = new Date(Date.now() + resetTokenTtlMs);

    await users.updateOne(
      { _id: user._id },
      {
        $set: {
          resetPasswordToken: hashedToken,
          resetPasswordExpires,
          updatedAt: new Date(),
        },
      }
    );

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      "http://localhost:3000";
    const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;
    const emailResult = await sendPasswordResetEmail({ to: user.email, resetUrl });

    sendJson(res, 200, {
      success: true,
      message: "If an account exists with that email, a password reset link has been sent.",
      ...(emailResult.devResetUrl ? { devResetUrl: emailResult.devResetUrl } : {}),
      ...(process.env.NODE_ENV === "development" && emailResult.error
        ? { emailError: emailResult.error }
        : {}),
    });
    return;
  }

  sendJson(res, 200, {
    success: true,
    message: "If an account exists with that email, a password reset link has been sent.",
  });
}

async function resetPassword(req, res) {
  const { token, password } = await readJson(req);

  if (!token || typeof token !== "string") {
    sendJson(res, 400, { error: "Token is required" });
    return;
  }

  if (!password || typeof password !== "string" || password.length < 6) {
    sendJson(res, 400, { error: "Password must be at least 6 characters" });
    return;
  }

  const users = await getUsersCollection();
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
  const user = await users.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() },
  });

  if (!user) {
    sendJson(res, 400, { error: "Invalid or expired reset token" });
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  const providers = Array.from(new Set([...(user.providers || []), "credentials"]));

  await users.updateOne(
    { _id: user._id },
    {
      $set: {
        password: hash,
        providers,
        updatedAt: new Date(),
      },
      $unset: {
        resetPasswordToken: "",
        resetPasswordExpires: "",
      },
    }
  );

  sendJson(res, 200, { success: true });
}

async function handle(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, service: serviceName });
    return;
  }

  if (url.pathname === "/signup" && req.method === "POST") {
    await signup(req, res);
    return;
  }

  if (url.pathname === "/forgot-password" && req.method === "POST") {
    await forgotPassword(req, res);
    return;
  }

  if (url.pathname === "/reset-password" && req.method === "POST") {
    await resetPassword(req, res);
    return;
  }

  sendJson(res, 404, { error: "Not Found", service: serviceName });
}

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    sendJson(res, error.status || 500, {
      error: error.status ? error.message : "Internal server error",
      service: serviceName,
    });
  }
});

server.listen(port, () => {
  console.log(`${serviceName} listening on ${port}`);
});
