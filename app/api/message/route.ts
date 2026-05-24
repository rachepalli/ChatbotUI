import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { proxyJson } from "@/lib/http/service-proxy";

const gatewayUrl = process.env.API_GATEWAY_URL;
const chatServiceUrl = process.env.CHAT_SERVICE_URL || "http://localhost:4003";

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ messages: [] });
    }

    const chatId = req.nextUrl.searchParams.get("chatId") || undefined;
    if (!chatId) {
      return NextResponse.json({ messages: [] });
    }

    const headers = { "x-user-id": session.user.email };
    let response = null;

    if (gatewayUrl) try {
      response = await proxyJson({
        baseUrl: gatewayUrl,
        path: "/api/message",
        method: "GET",
        query: { chatId },
        headers,
        timeoutMs: 2000,
      });
    } catch {
      response = null;
    }

    if (!response || response.status === 404 || response.status === 502) {
      response = await proxyJson({
        baseUrl: chatServiceUrl,
        path: "/message",
        method: "GET",
        query: { chatId },
        headers,
      });
    }

    return NextResponse.json(response.data, { status: response.status });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}
