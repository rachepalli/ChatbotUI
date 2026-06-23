import crypto from "crypto";
import { NextResponse } from "next/server";
import { proxyJson } from "@/lib/http/service-proxy";
import { connectToDatabase } from "@/lib/mongodb";
import { sendPasswordResetEmail } from "@/lib/email";
import User from "@/models/User";

const gatewayUrl = process.env.API_GATEWAY_URL;
const authServiceUrl = process.env.AUTH_SERVICE_URL;
const resetTokenTtlMs = 15 * 60 * 1000;

function normalizeEmail(email: unknown) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

async function tryProxyForgotPassword(baseUrl: string | undefined, path: string, body: unknown) {
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
    console.error(`Forgot password proxy failed for ${path}`, error);
    return null;
  }
}

async function forgotPasswordLocally(body: unknown) {
  const payload = body as { email?: unknown };
  const email = normalizeEmail(payload.email);

  if (!email) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  await connectToDatabase();
  const user = await User.findOne({ email });

  if (user) {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + resetTokenTtlMs);
    await user.save();

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      "http://localhost:3000";
    const emailResult = await sendPasswordResetEmail({
      to: user.email,
      resetUrl: `${baseUrl}/reset-password?token=${rawToken}`,
    });

    return NextResponse.json({
      success: true,
      message: "If an account exists with that email, a password reset link has been sent.",
      ...(emailResult.devResetUrl ? { devResetUrl: emailResult.devResetUrl } : {}),
      ...(process.env.NODE_ENV === "development" && emailResult.error
        ? { emailError: emailResult.error }
        : {}),
    });
  }

  return NextResponse.json({
    success: true,
    message: "If an account exists with that email, a password reset link has been sent.",
  });
}

export async function POST(req: Request) {
  let body: unknown;

  try {
    body = await req.json();

    let response = await tryProxyForgotPassword(gatewayUrl, "/api/auth/forgot-password", body);

    if (!response || response.status === 404 || response.status === 502) {
      response = await tryProxyForgotPassword(authServiceUrl, "/forgot-password", body);
    }

    if (!response || response.status === 404 || response.status === 502) {
      return forgotPasswordLocally(body);
    }

    return NextResponse.json(response.data, { status: response.status });
  } catch (error) {
    console.error("Forgot password request failed", error);

    if (body !== undefined) {
      try {
        return await forgotPasswordLocally(body);
      } catch (localError) {
        console.error("Local forgot password failed", localError);
      }
    }

    return NextResponse.json(
      { error: "Unable to process forgot password request" },
      { status: 500 }
    );
  }
}
