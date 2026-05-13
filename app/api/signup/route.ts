import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { proxyJson } from "@/lib/http/service-proxy";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";

const gatewayUrl = process.env.API_GATEWAY_URL || "http://localhost:8080";
const authServiceUrl = process.env.AUTH_SERVICE_URL || "http://localhost:4001";

function normalizeEmail(email: unknown) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

async function signupLocally(body: unknown) {
  const payload = body as { name?: unknown; email?: unknown; password?: unknown };
  const email = normalizeEmail(payload.email);
  const password = typeof payload.password === "string" ? payload.password : "";
  const name = typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : "User";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  await connectToDatabase();
  const existing = await User.findOne({ email });

  if (existing) {
    return NextResponse.json({ error: "User already exists" }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 10);
  await User.create({
    name,
    email,
    password: hash,
    image: "",
    providers: ["credentials"],
    hasOnboarded: false,
  });

  return NextResponse.json({ success: true }, { status: 201 });
}

export async function POST(req: Request) {
  let body: unknown;

  try {
    body = await req.json();

    let response;
    try {
      response = await proxyJson({
        baseUrl: gatewayUrl,
        path: "/api/signup",
        method: "POST",
        body,
      });
    } catch {
      response = null;
    }

    if (!response || response.status === 404 || response.status === 502) {
      response = await proxyJson({
        baseUrl: authServiceUrl,
        path: "/signup",
        method: "POST",
        body,
      });
    }

    if (!response || response.status === 404 || response.status === 502) {
      return signupLocally(body);
    }

    return NextResponse.json(response.data, { status: response.status });
  } catch {
    if (body !== undefined) {
      try {
        return await signupLocally(body);
      } catch {
        return NextResponse.json({ error: "Signup failed" }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Invalid signup request" }, { status: 400 });
  }
}
