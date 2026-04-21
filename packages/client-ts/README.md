# @behest/client-ts

TypeScript/Node.js SDK for the [Behest](https://behest.ai) inference gateway.

**v1.5 (beta)** adds per-end-user JWT minting, persistent threads, session memory, usage reporting, and typed errors — alongside the OpenAI-compatible chat surface. Works with API-key mode (one HTTP round-trip per mint) or local RSA signing mode (zero outbound calls).

## Install

```bash
npm install @behest/client-ts@beta
```

Requires Node 18+. `openai` is a peer dep; install it too if you're also using the plain OpenAI SDK.

## Environment

The SDK reads these on `new Behest()`:

| Var | Required | Notes |
|---|---|---|
| `BEHEST_KEY` | ✅ | `behest_sk_live_...` (apiKey mode) **or** `behest_pk_<base64-PEM>` (sign mode). Auto-detected by prefix. |
| `BEHEST_BASE_URL` | ✅ | Your project slug host — `https://<slug>.behest.app`. |
| `BEHEST_KID` | sign mode only | Key id from dashboard → Signing Keys. |
| `BEHEST_TENANT_ID` | sign mode only | |
| `BEHEST_PROJECT_ID` | sign mode only | |

## Quick start

```ts
import { Behest } from "@behest/client-ts";

const behest = new Behest(); // reads env; also accepts explicit options

// Mint a per-user JWT (apiKey mode: HTTP POST /v1/auth/mint; sign mode: local jose sign).
const { token, sessionId } = await behest.auth.mint({ user_id: "u_42" });

// Chat completion — SDK auto-attaches the JWT + X-Session-Id.
const res = await behest.chat.completions.create({
  messages: [{ role: "user", content: "Hi!" }],
});
console.log(res.choices[0].message.content);
```

Or hand it `user_id` per call and skip the explicit mint:

```ts
await behest.chat.completions.create({
  messages: [{ role: "user", content: "Hi!" }],
  user_id: "u_42", // SDK mints + attaches token + X-Session-Id for this call
});
```

## Streaming

```ts
const stream = await behest.chat.completions.create({
  messages: [{ role: "user", content: "Write a haiku" }],
  stream: true,
  user_id: "u_42",
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

Pass `signal: AbortController.signal` in the second-arg options to cancel.

## Threads (persistent conversations)

```ts
await behest.threads.list();                // Thread[]
await behest.threads.get(threadId);         // Thread
await behest.threads.messages(threadId);    // ThreadMessage[]
await behest.threads.delete(threadId);      // void (204)
```

Scope is automatic — the JWT's `uid` filters rows server-side. Every thread call sends `X-Session-Id` and the JWT, so you get per-user isolation without any work on your side.

## Usage

```ts
const report = await behest.usage.get({
  from: new Date(Date.now() - 24 * 60 * 60 * 1000),
  to: new Date(),
  granularity: "hour",
});
// { totals: { tokens, cost_usd }, breakdown: [{ timestamp, tokens, cost_usd }, ...] }
```

## Typed errors

```ts
import {
  BehestAuthError,      // 401 / 403
  BehestQuotaError,     // 402
  BehestRateLimitError, // 429 (exposes .retryAfter in seconds)
  BehestBadRequestError,// 400 / 422
  BehestServerError,    // 5xx
  BehestConfigError,    // local config problem
} from "@behest/client-ts";

try {
  await behest.chat.completions.create({ messages, user_id });
} catch (err) {
  if (err instanceof BehestRateLimitError) await wait(err.retryAfter);
  else if (err instanceof BehestQuotaError) showUpgrade(err);
  else throw err;
}
```

Every error exposes `.status`, `.code`, `.traceId` (matches the `X-Trace-Id` response header — use in support tickets), and `.raw` (parsed body).

## Local-signing mode

Sign JWTs locally with an RSA private key scoped to your tenant — **zero HTTP round-trips per mint**. Great for high-QPS backends, edge runtimes, or "no outbound secrets traffic" policies.

### 1. Generate a signing key

Dashboard → **Settings → Signing Keys → Generate**. You'll get two things **shown only once**:

- A PKCS#8 PEM private key — keep this server-side only.
- A `kid` (key id) — a short string like `kid_7h4m2p`. Public by design.

The public half is automatically added to your tenant's JWKS at `https://<slug>.behest.app/.well-known/jwks.json`; Kong picks it up within a few minutes and starts accepting JWTs signed with the matching `kid`.

### 2. Encode + set env vars

```bash
# Base64-encode the PEM (one line, trim trailing newline)
PEM_B64=$(base64 < ./tenant-private-key.pem | tr -d '\n')

# Put the behest_pk_ prefix in front so the SDK auto-detects sign mode
echo "BEHEST_KEY=behest_pk_${PEM_B64}"                    >> .env
echo "BEHEST_BASE_URL=https://amber-fox-042.behest.app"   >> .env
echo "BEHEST_KID=kid_7h4m2p"                              >> .env
echo "BEHEST_TENANT_ID=tnt_..."                           >> .env
echo "BEHEST_PROJECT_ID=proj_..."                         >> .env
```

Alternative: skip the `behest_pk_` prefix and paste the base64 PEM directly — the SDK detects PKCS#8 PEM bytes as a fallback.

### 3. Use it — no code change

```ts
import { Behest } from "@behest/client-ts";

const behest = new Behest();  // SDK sees behest_pk_ prefix → sign mode

// Exact same API surface. No HTTP call — signs locally with jose.
const { token, sessionId } = await behest.auth.mint({ user_id: "u_42" });

await behest.chat.completions.create({
  messages: [{ role: "user", content: "Hi!" }],
  user_id: "u_42",
});
```

### Advanced: pass the key programmatically

If you don't want the key in env (e.g., fetched from a secrets manager at startup):

```ts
const pemFromSecretsManager = await fetchFromVault("tenant-jwt-key");
const behest = new Behest({
  key: pemFromSecretsManager,   // raw PEM string; no prefix needed
  baseUrl: "https://amber-fox-042.behest.app",
  kid: "kid_7h4m2p",
  tenantId: "tnt_...",
  projectId: "proj_...",
});
```

### Rotation

Generate a new key → deploy with the new `BEHEST_KID` + `BEHEST_KEY` → revoke the old `kid` in the dashboard. Kong stops accepting JWTs signed with the revoked `kid` within ~5 min (JWKS cache TTL). This is the only path that gives you **real revocation for already-issued JWTs** — API-key mint tokens live until their `exp`.

### Server-side only

Local signing is **server-side only**. The SDK throws `BehestConfigError` if you try to construct it in a browser (`typeof window !== "undefined"`). Browsers must use the API-key mint flow from a backend (see `@behest/react`) or call pre-minted tokens directly with plain `fetch`/OpenAI SDK.

## Browser safety

Never import `@behest/client-ts` in the browser. The browser gets a short-lived JWT from your own backend (which uses this SDK to mint), then calls Behest directly with `new OpenAI({ apiKey: jwt, baseURL, dangerouslyAllowBrowser: true })` — or uses [`@behest/react`](https://www.npmjs.com/package/@behest/react) for the full hook experience.

## Full guides

- **Quickstarts**: https://docs.behest.ai/developer/quickstarts
- **Auth modes** (API-key vs local signing): https://docs.behest.ai/developer/guides/auth-modes
- **Multi-conversation chat** (sessions + threads): https://docs.behest.ai/developer/guides/multi-conversation-chat
- **Streaming UI** (abort, reconnect, typewriter): https://docs.behest.ai/developer/guides/streaming-ui
- **Error handling**: https://docs.behest.ai/developer/guides/error-handling

## Legacy `BehestClient` (v1.x)

The pre-v1.5 `BehestClient` class is still exported. It is a thin OpenAI-SDK wrapper that takes a `behest_sk_live_...` key directly (no mint). If you are already using it, nothing breaks — but new integrations should use `Behest` for per-user JWTs, threads, and session memory.

```ts
import { BehestClient } from "@behest/client-ts"; // v1.x, still supported through v2.0
const client = new BehestClient({ apiKey: process.env.BEHEST_KEY, baseURL: "https://<slug>.behest.app/v1" });
```

## License

MIT
