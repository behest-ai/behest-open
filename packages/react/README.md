# @behest/react

Browser-safe React hooks for the Behest inference gateway. Fetch a short-lived per-user JWT from your backend, stream chat completions directly from the browser, manage threads — all without a Behest key ever touching client code.

Designed to drop into any React + backend setup: Next.js, Remix, Vite + Express, SPA + FastAPI, etc. Same pattern as Clerk / Supabase / Vercel AI SDK — your app mints a scoped token, the browser uses it.

## Install

```bash
npm install @behest/react openai
```

Peer deps: `react >= 18`, `openai >= 4`.

## Usage

### 1. Provider

```tsx
// app/providers.tsx
"use client";
import { BehestProvider } from "@behest/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <BehestProvider
      baseUrl={process.env.NEXT_PUBLIC_BEHEST_BASE_URL!}  // e.g. https://amber-fox-042.behest.app
      tokenEndpoint="/api/behest/token"                   // your server route that mints a JWT
    >
      {children}
    </BehestProvider>
  );
}
```

Your `/api/behest/token` endpoint is where the Behest key lives. Use `@behest/client-ts` on the server to mint — see that package's docs for the v1.5 dual-mode SDK.

### 2. Chat hook

```tsx
"use client";
import { useBehestChat } from "@behest/react";

export function Chat({ threadId }: { threadId?: string }) {
  const { messages, input, setInput, send, stop, isLoading } = useBehestChat({
    threadId,
  });

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}><b>{m.role}:</b> {m.content}</div>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
      />
      {isLoading && <button onClick={stop}>Stop</button>}
    </div>
  );
}
```

### 3. Threads hook

```tsx
import { useBehestThreads } from "@behest/react";

export function ThreadSidebar({ onSelect }: { onSelect: (id: string) => void }) {
  const { threads, loading, remove } = useBehestThreads();
  if (loading) return null;
  return (
    <ul>
      {threads.map((t) => (
        <li key={t.id} onClick={() => onSelect(t.id)}>
          {t.title ?? t.id} <button onClick={() => remove(t.id)}>×</button>
        </li>
      ))}
    </ul>
  );
}
```

Threads talk to routes your app owns — by default `GET /api/behest/threads`, `GET /api/behest/threads/:id/messages`, `DELETE /api/behest/threads/:id`. Your server implements those by calling `behest.threads.*` from `@behest/client-ts`.

## Token endpoint contract

Your server route (`tokenEndpoint` or `fetchToken`) must return JSON in this shape:

```json
{
  "token": "eyJhbGciOi...",
  "sessionId": "1c2...",
  "ttl": 900,
  "expiresAt": 1735689600
}
```

This is exactly what `behest.auth.mint({ user_id })` returns in the v1.5 SDK. Pass it through as-is.

## What this package does NOT do

- It does not import or handle `BEHEST_KEY`. The key never leaves your server.
- It does not store tokens in `localStorage` or cookies. Tokens live only in the memory of the `BehestProvider` instance.
- It does not proxy chat calls through your server. The browser talks to Behest directly with the JWT, which is the whole point.

## License

MIT
