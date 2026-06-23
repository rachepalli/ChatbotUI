import crypto from "crypto";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { proxyJson } from "@/lib/http/service-proxy";
import { connectToDatabase } from "@/lib/mongodb";
import User from "@/models/User";

const gatewayUrl = process.env.API_GATEWAY_URL;
const authServiceUrl = process.env.AUTH_SERVICE_URL;

async function tryProxyResetPassword(baseUrl: string | undefined, path: string, body: unknown) {
  if (!baseUrl) return null;

  try {
    return await proxyJson({
      baseUrl,
      path,
      method: "POST",
      body,
      timeoutMs: 15000,
    });
  } catch (error) {
    console.error(`Reset password proxy failed for ${path}`, error);
    return null;
  }
}

async function resetPasswordLocally(body: unknown) {
  const payload = body as { token?: unknown; password?: unknown };
  const token = typeof payload.token === "string" ? payload.token : "";
  const password = typeof payload.password === "string" ? payload.password : "";

  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  await connectToDatabase();
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() },
  });

  if (!user) {
    return NextResponse.json({ error: "Invalid or expired reset token" }, { status: 400 });
  }

  user.password = await bcrypt.hash(password, 10);
  user.providers = Array.from(new Set([...(user.providers || []), "credentials"]));
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  return NextResponse.json({ success: true });
}

export async function POST(req: Request) {
  let body: unknown;

  try {
    body = await req.json();

    let response = await tryProxyResetPassword(gatewayUrl, "/api/auth/reset-password", body);

    if (!response || response.status === 404 || response.status === 502) {
      response = await tryProxyResetPassword(authServiceUrl, "/reset-password", body);
    }

    if (!response || response.status === 404 || response.status === 502) {
      return resetPasswordLocally(body);
    }

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    console.error("Reset password request failed", error);

    if (body !== undefined) {
      try {
        return await resetPasswordLocally(body);
      } catch (localError) {
        console.error("Local reset password failed", localError);
      }
    }

    return NextResponse.json({ error: "Unable to reset password" }, { status: 500 });
  }
}
