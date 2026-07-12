# Behest + Vercel Edge Example

A fully-working chat app demonstrating Behest on Vercel's Edge Runtime with Next.js 15, NextAuth, and Vercel AI SDK's `useChat` hook.

## Features

- **Edge Runtime token minting** — 10x faster cold starts than Node serverless
- **Server-side chat streaming** — Uses Vercel AI SDK `useChat` for drop-in DX
- **NextAuth integration** — Proof-of-concept auth (demo users: alice/bob)
- **Full streaming** — Real-time token-by-token chat responses
- **No browser token exposure** — Server vends fresh tokens per request

## Quick Start

### Prerequisites
- Node 18+
- A Behest project + API key (from [dashboard](https://dashboard.behest.app))
- (Optional) Vercel account for deployment

### 1. Install
```bash
npm install
```

### 2. Set up environment
Copy `.env.example` to `.env.local` and fill in your Behest credentials:
```bash
cp .env.example .env.local
```

Then edit `.env.local`:
```
AUTH_SECRET=replace_with_random_string
BEHEST_KEY=behest_sk_live_...
BEHEST_BASE_URL=https://your-slug.behest.app
NEXT_PUBLIC_BEHEST_BASE_URL=https://your-slug.behest.app
```

**Generate AUTH_SECRET:**
```bash
openssl rand -base64 32
```

### 3. Add allowed origins
In the Behest dashboard → Project → Settings → **Allowed Origins**, add:
```
http://localhost:3000
```

### 4. Run locally
```bash
npm run dev
```

Visit `http://localhost:3000`, sign in with **alice / alice123**, and send a message.

## What's Inside

| File | Purpose |
|------|---------|
| `app/api/behest/token/route.ts` | Vend short-lived user tokens (15 min TTL) |
| `app/api/chat/route.ts` | Stream chat via Behest + Vercel AI SDK |
| `components/ChatClient.tsx` | Browser component wrapping `useChat` |
| `auth.ts` | NextAuth mock auth (demo users) |
| `app/page.tsx` | Sign-in page |
| `app/chat/page.tsx` | Chat page (redirects here after login) |

## How It Works

```
1. User signs in via NextAuth
   ↓
2. Browser calls /api/behest/token → gets a 15-min JWT
   ↓
3. Browser calls /api/chat with messages
   ↓
4. Server-side route mints a fresh token + calls Behest
   ↓
5. Behest streams back via OpenAI-compatible API
   ↓
6. Vercel AI SDK helper converts stream → browser JSON
   ↓
7. useChat hook updates messages in real-time
```

## Deploy to Vercel

### 1. Push your changes
```bash
git push origin main
```

### 2. Create a new project on Vercel
1. Go to [Vercel dashboard](https://vercel.com)
2. Click "New Project"
3. Import your fork (ArenGolazizian/behest-open)
4. Select the `examples/vercel-edge` directory as the root

### 3. Set environment variables
In Vercel → Project Settings → Environment Variables, add:
- `AUTH_SECRET` — same value as local
- `BEHEST_KEY` — your API key
- `BEHEST_BASE_URL` — your Behest slug URL
- `NEXT_PUBLIC_BEHEST_BASE_URL` — same as above

### 4. Set allowed origins in Behest
Add your Vercel deployment URL to Behest Allowed Origins:
```
https://your-project.vercel.app
https://your-project-*.vercel.app
```

### 5. Deploy
Click "Deploy". Vercel will auto-build and deploy.

**Verify:**
1. Go to your Vercel deployment URL
2. Sign in
3. Send a message
4. Check Vercel dashboard → Functions tab → should see `api/behest/token` and `api/chat` marked as "Edge"

## Troubleshooting

### CORS errors on `/api/chat`?
Not expected — the browser only calls your domain (`/api/chat`), not Behest directly. If you see CORS errors:
- Check browser console for exact error
- Verify environment variables are set

### Token route returns 401?
- Confirm you're signed in (session should exist)
- Check `AUTH_SECRET` is set
- Verify NextAuth routes work: visit `/api/auth/signin`

### Chat returns 500?
- Check Vercel logs: Vercel dashboard → Deployments → your deployment → Logs
- Verify `BEHEST_KEY` and `BEHEST_BASE_URL` are correct
- Test token route directly: POST to `/api/behest/token` while logged in

### "Invalid username or password" on sign-in?
- Demo users only: use **alice / alice123** or **bob / bob123**
- To add real users, modify `auth.ts`

## Next Steps

Replace demo auth with your own:
- **Clerk** — Replace NextAuth with `@clerk/nextjs`
- **Supabase** — Use `@supabase/supabase-js` + sessions
- **Auth0** — Swap NextAuth provider config
- **Custom database** — Store users in Postgres/MongoDB

## See Also

- [Behest Docs](https://docs.behest.ai)
- [Behest TypeScript SDK](https://github.com/behest-ai/behest-sdk-ts)
- [Next.js App Router](https://nextjs.org/docs)
- [Vercel AI SDK](https://sdk.vercel.ai)
- [NextAuth.js](https://authjs.dev)
