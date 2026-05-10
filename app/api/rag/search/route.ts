import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { proxyJson } from "@/lib/http/service-proxy";

const gatewayUrl = process.env.API_GATEWAY_URL || "http://localhost:8080";
const chatServiceUrl = process.env.CHAT_SERVICE_URL || "http://localhost:4003";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const headers = { "x-user-id": session.user.email };

    let response;
    try {
      response = await proxyJson({
        baseUrl: gatewayUrl,
        path: "/api/chat/rag/search",
        method: "POST",
        body,
        headers,
      });
    } catch {
      response = null;
    }

    if (!response || response.status === 404 || response.status === 502) {
      response = await proxyJson({
        baseUrl: chatServiceUrl,
        path: "/rag/search",
        method: "POST",
        body,
        headers,
      });
    }

    return Response.json(response.data, { status: response.status });
  } catch {
    return Response.json({ error: "RAG search failed", results: [] }, { status: 500 });
  }
}
