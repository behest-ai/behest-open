# Environment Configuration Guide

This guide explains how to configure the Behest Chat Demo for different environments.

## Quick Start (Local Development)

```bash
# 1. Copy template
cp .env.example .env

# 2. Edit file and set your credentials
nano .env
# Update both:
# BEHEST_API_KEY=your-key-here
# BEHEST_BASE_URL=your-project-domain

# 3. Install dependencies
npm install

# 4. Run server
npm start

# 5. Open browser
open http://localhost:3080
# or visit http://localhost:3080 manually
```

## Environment Files

### `.env` or `.env.local` — Local Development
**Used when:** Running `npm start` on your machine

```env
BEHEST_API_KEY=behest_sk_live_xxx         # Your real API key
BEHEST_BASE_URL=https://your-project-name.behest.app
PORT=3080
NODE_ENV=development
SESSION_SECRET=local-dev-secret-xxx
CORS_ORIGIN=http://localhost:3080
LOG_LEVEL=debug
```

✅ **DO:**
- Set your real Behest API key here
- Set your Behest project domain (base URL)
- Add to `.gitignore` (local only, never commit)

❌ **DON'T:**
- Commit `.env.local` to git
- Share your API key via Slack, email, etc.
- Use production credentials locally

### `.env.dev` — Development Environment
**Used when:** Running in Docker Compose or staging

```env
BEHEST_API_KEY=${BEHEST_API_KEY_DEV}      # Load from secret management
BEHEST_BASE_URL=https://dev.internal.behest.ai
PORT=3080
NODE_ENV=development
SESSION_SECRET=${SESSION_SECRET_DEV}       # Load from secret management
CORS_ORIGIN=http://localhost:3080,https://chat-dev.internal.behest.ai
LOG_LEVEL=debug
```

✅ **DO:**
- Safe to commit to git (no hardcoded secrets)
- Use `${VARIABLE}` syntax for secrets
- Load secrets from environment at deploy time

### `.env.prod` — Production Environment
**Used when:** Running in production Kubernetes cluster

```env
BEHEST_API_KEY=${BEHEST_API_KEY_PROD}
BEHEST_BASE_URL=https://api.behest.app
PORT=3000
NODE_ENV=production
SESSION_SECRET=${SESSION_SECRET_PROD}
CORS_ORIGIN=https://chat.behest.app
LOG_LEVEL=info
```

⚠️ **CRITICAL:**
- Never hardcode secrets in `.env.prod`
- All `${VARIABLE}` values must come from secure secret management
- Use Kubernetes Secrets, AWS Secrets Manager, GCP Secret Manager, etc.

## Configuration for Different Platforms

### Docker Compose

```bash
# Create .env from template
cp .env.example .env

# Edit and set values
nano .env

# Run with Docker
docker-compose up

# Or pass env vars directly
docker run -e BEHEST_API_KEY=sk_live_xxx -p 3080:3080 behest-chat-demo
```

### Kubernetes

```bash
# Create secret from your values
kubectl create secret generic behest-chat \
  --from-literal=BEHEST_API_KEY_PROD=sk_live_xxx \
  --from-literal=SESSION_SECRET_PROD=secure-secret-xxx

# Reference in deployment (see k8s/ folder)
```

### GitHub Actions

```yaml
# In .github/workflows/deploy.yml
env:
  BEHEST_API_KEY_DEV: ${{ secrets.BEHEST_API_KEY_DEV }}
  SESSION_SECRET_DEV: ${{ secrets.SESSION_SECRET_DEV }}
  BEHEST_API_KEY_PROD: ${{ secrets.BEHEST_API_KEY_PROD }}
  SESSION_SECRET_PROD: ${{ secrets.SESSION_SECRET_PROD }}
```

### Cloud Run / Cloud Functions

```bash
gcloud run deploy behest-chat-demo \
  --set-env-vars BEHEST_API_KEY=${BEHEST_API_KEY} \
  --set-env-vars BEHEST_BASE_URL=https://api.behest.app \
  --set-env-vars NODE_ENV=production
```

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `BEHEST_API_KEY` | ✅ Yes | Your private API key | `behest_sk_live_xxx` |
| `BEHEST_BASE_URL` | ✅ Yes | Behest API endpoint | `https://your-project-name.behest.app` |
| `BEHEST_CHAT_URL` | ⚠️ Optional | Chat endpoint (same as BASE) | `https://your-project-name.behest.app` |
| `PORT` | ⚠️ Optional | Server port | `3080` |
| `NODE_ENV` | ⚠️ Optional | Environment mode | `development`, `production` |
| `SESSION_SECRET` | ✅ Yes | Cookie signing secret | `random-32-char-string` |
| `CORS_ORIGIN` | ⚠️ Optional | Allowed CORS origins | `http://localhost:3080` |
| `LOG_LEVEL` | ⚠️ Optional | Logging level | `debug`, `info`, `warn`, `error` |

## Getting Your API Key and Base URL

1. **Go to Behest Dashboard:**
   - Visit https://behest.ai/dashboard/projects
   - Sign in with your account

2. **Select Your Project:**
   - Click on your project
   - Click "View API Keys"

3. **Copy Both Values:**
   - `BEHEST_API_KEY` — Copy your API key (format: `behest_sk_live_xxx`)
   - `BEHEST_BASE_URL` — Copy your Project Domain (format: `https://your-project-name.behest.app`)

4. **Add to Environment:**
   ```bash
   BEHEST_API_KEY=behest_sk_live_xxx
   BEHEST_BASE_URL=https://your-project-name.behest.app
   ```

## Testing Your Setup

### Test 1: Check Server Starts

```bash
npm start
# Should see:
# ✅ Behest Chat Demo: http://localhost:3080
# ✅ API Key Status: ✅ Configured
```

### Test 2: Check Login Works

```bash
curl -X POST http://localhost:3080/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"alice123"}'
# Should return: {"user":{"id":"alice","username":"alice"}}
```

### Test 3: Check Chat Works

```bash
# First, get session by logging in
curl -c cookies.txt -X POST http://localhost:3080/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"alice123"}'

# Then call chat
curl -b cookies.txt -X POST http://localhost:3080/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role":"user","content":"Hello"}],
    "model": "gemini-2.5-flash"
  }'
# Should return: {"choices":[{"message":{"content":"..."}}]}
```

## Troubleshooting

### Error: "BEHEST_API_KEY not configured"
- **Solution:** Set `BEHEST_API_KEY` in `.env.local`
- Check: `grep BEHEST_API_KEY .env.local`

### Error: "Behest mint failed: 401"
- **Solution:** API key may be expired or invalid
- Try: Get a fresh API key from dashboard

### Error: "Not authenticated"
- **Solution:** Login first with `/api/login`
- Test: Use demo credentials (alice/alice123)

### CORS errors in browser
- **Solution:** Check `CORS_ORIGIN` matches your frontend URL
- Example: If frontend is `http://localhost:3000`, set `CORS_ORIGIN=http://localhost:3000`

### Port already in use
- **Solution:** Change `PORT` to a different number
- Example: `PORT=3081`

## Next Steps

1. ✅ Configure `.env.local`
2. ✅ Run `npm install`
3. ✅ Run `npm start`
4. ✅ Visit http://localhost:3080
5. ✅ Login with alice/alice123
6. ✅ Try chatting!

## For Production

Before deploying to production:

- [ ] Generate strong `SESSION_SECRET` (32+ chars, high entropy)
- [ ] Use production Behest instance URL
- [ ] Store all secrets in secure vault (don't hardcode)
- [ ] Enable HTTPS only
- [ ] Set `NODE_ENV=production`
- [ ] Set `LOG_LEVEL=info` (reduce verbose logging)
- [ ] Configure proper `CORS_ORIGIN` for your domain
- [ ] Review all environment variables

See `README.md` for more details.
