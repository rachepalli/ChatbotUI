import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { proxyJson } from "@/lib/http/service-proxy";

const gatewayUrl = process.env.API_GATEWAY_URL;
const chatServiceUrl = process.env.CHAT_SERVICE_URL || "http://localhost:4003";
const chatServiceTimeoutMs = 75000;

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const headers = { "x-user-id": session.user.email };

    let response = null;
    if (gatewayUrl) try {
      response = await proxyJson({
        baseUrl: gatewayUrl,
        path: "/api/chat",
        method: "POST",
        body,
        headers,
        timeoutMs: 2000,
      });
    } catch {
      response = null;
    }

    if (!response || response.status === 404 || response.status === 502) {
      response = await proxyJson({
        baseUrl: chatServiceUrl,
        path: "/",
        method: "POST",
        body,
        headers,
        timeoutMs: chatServiceTimeoutMs,
      });
    }

    return Response.json(response.data, { status: response.status });
  } catch (error) {
    console.error("Chat route failed", error);
    return Response.json(
      {
        error: "Internal Server Error",
        reply: error instanceof Error ? error.message : "AI pipeline failed",
      },
      { status: 500 }
    );
  }
}
