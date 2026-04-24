import { Behest } from "@behest/client-ts";
import { OpenAIStream, StreamingTextResponse } from "ai";
import { auth } from "@/auth";

// NOTE: `export const runtime = "edge"` is intentionally omitted.
// @behest/client-ts imports `randomUUID` from Node.js crypto, which is
// unavailable on the Edge Runtime. Add this export once the SDK is updated.

const behest = new Behest();

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { messages } = await req.json();

  // Mint a short-lived token tied to this user (15 min TTL).
  const { token } = await behest.auth.mint({
    user_id: session.user.id,
    ttl: 900,
  });

  // Call Behest server-to-server — no CORS restrictions.
  const upstream = await fetch(
    `${process.env.BEHEST_BASE_URL}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages,
        stream: true,
      }),
    },
  );

  if (!upstream.ok) {
    const text = await upstream.text();
    console.error("[/api/chat] Behest error:", upstream.status, text);
    return new Response(text, { status: upstream.status });
  }

  // OpenAIStream converts Behest's SSE response into the format useChat expects.
  return new StreamingTextResponse(OpenAIStream(upstream));
}
