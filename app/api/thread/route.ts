import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { proxyJson } from "@/lib/http/service-proxy";

const gatewayUrl = process.env.API_GATEWAY_URL || "http://localhost:8080";
const threadServiceUrl = process.env.THREAD_SERVICE_URL || "http://localhost:4002";

async function getUserHeader() {
  const session = await getServerSession(authOptions);
  return session?.user?.email ? { "x-user-id": session.user.email } : null;
}

async function proxyThread(input: {
  method: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
}) {
  const headers = await getUserHeader();
  if (!headers) {
    return { data: { error: "Unauthorized" }, status: 401 };
  }

  let response;
  try {
    response = await proxyJson({
      baseUrl: gatewayUrl,
      path: "/api/thread",
      method: input.method,
      body: input.body,
      headers,
    });
  } catch {
    response = null;
  }

  if (!response || response.status === 404 || response.status === 502) {
    response = await proxyJson({
      baseUrl: threadServiceUrl,
      path: "/",
      method: input.method,
      body: input.body,
      headers,
    });
  }

  return response;
}

export async function GET() {
  try {
    const response = await proxyThread({ method: "GET" });
    return NextResponse.json(response.data, { status: response.status });
  } catch {
    return NextResponse.json({ threads: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const response = await proxyThread({
      method: "POST",
      body: await req.json(),
    });
    return NextResponse.json(response.data, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const response = await proxyThread({
      method: "PUT",
      body: await req.json(),
    });
    return NextResponse.json(response.data, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const response = await proxyThread({
      method: "DELETE",
      body: await req.json(),
    });
    return NextResponse.json(response.data, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
