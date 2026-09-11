// Proxy from our app to the mock server.
// Browser can't call localhost:4000 directly (CORS + different origin),
// so we forward the request server-side.

import { NextResponse } from "next/server";

const MOCK_URL = process.env.MOCK_URL || "http://localhost:4000";

export async function POST(req: Request) {
  const body = await req.text();

  try {
    const upstream = await fetch(`${MOCK_URL}/v1/reports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(15000),
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type":
          upstream.headers.get("content-type") || "application/json",
        ...(upstream.headers.get("retry-after")
          ? { "retry-after": upstream.headers.get("retry-after")! }
          : {}),
      },
    });
  } catch (err) {
    // Network error between US and the mock server.
    // Return a synthetic 502 so the client treats it as retryable.
    return NextResponse.json(
      { error: "proxy_network_error" },
      { status: 502 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}