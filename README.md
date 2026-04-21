# Behest Open

Open-source SDKs, libraries, and examples for the [Behest](https://behest.ai) inference platform — an OpenAI-compatible gateway with per-end-user JWT auth, session memory, persistent threads, and BYOK.

## Packages

| Package | Purpose | Install |
|---|---|---|
| [`@behest/client-ts`](./packages/client-ts) | TypeScript/Node.js — server-side: `Behest` class, mint, chat, threads, usage, typed errors. Dual-mode (API key or local RSA signing). | `npm install @behest/client-ts@beta` |
| [`@behest/react`](./packages/react) | React hooks — browser-side: `BehestProvider`, `useBehestChat`, `useBehestThreads`. No Behest key ever in the browser. | `npm install @behest/react` |
| [`behest-ai`](./packages/client-py) | Python — same surface as client-ts. Module import stays `from behest import Behest`. | `pip install "behest-ai>=1.5"` |

All three are at `1.5.0-beta.1` / `1.5.0b1` and published under the `beta` tag. See each package's README for usage.

## Which one do I use?

```
Your code is a…          Use
─────────────────────────────────────────────────────
Node / Next.js server    @behest/client-ts
Python backend           behest-ai
React/Vite/Next frontend @behest/react + a backend route
React Native / mobile    Plain fetch + a backend route
                         (the backend uses client-ts or behest-ai)
Other (Go, Rust, …)      Raw REST — every /v1 endpoint is HTTP+JSON
```

The browser **never** holds `BEHEST_KEY`. Always: your backend mints a short-lived per-user JWT, the frontend uses that JWT to call Behest directly (or proxies through your server if you prefer).

## Quickstarts (on https://docs.behest.ai)

- [React + Vite](https://docs.behest.ai/developer/quickstarts/react-vite) — SPA with streaming chat.
- [Next.js App Router](https://docs.behest.ai/developer/quickstarts/nextjs-app-router) — route handler + client component.
- [Node + Express](https://docs.behest.ai/developer/quickstarts/node-express) — backend-only.
- [Python FastAPI](https://docs.behest.ai/developer/quickstarts/python-fastapi) — backend-only.
- [Vercel Edge + AI SDK](https://docs.behest.ai/developer/quickstarts/vercel-edge) — Edge Runtime token route, optional `useChat` integration.
- [Supabase Edge Functions](https://docs.behest.ai/developer/quickstarts/supabase-edge) — standalone Deno edge function for any frontend.
- [Lovable + Supabase](https://docs.behest.ai/developer/quickstarts/lovable-supabase) — the full Lovable stack.

## Examples

See [`examples/`](./examples) — runnable projects you can clone and deploy.

## License

MIT — all packages.
