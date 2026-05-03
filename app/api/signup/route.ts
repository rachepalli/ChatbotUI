import { NextResponse } from "next/server";
import { proxyJson } from "@/lib/http/service-proxy";

const gatewayUrl = process.env.API_GATEWAY_URL || "http://localhost:8080";
const authServiceUrl = process.env.AUTH_SERVICE_URL || "http://localhost:4001";

export async function POST(req: Request) {
  try {
    const body = await req.json();

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

    return NextResponse.json(response.data, { status: response.status });
  } catch {
    return NextResponse.json({ error: "Signup failed" }, { status: 500 });
  }
}
