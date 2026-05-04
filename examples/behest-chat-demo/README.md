# 🚀 Behest Chat Demo — Reference Implementation

A **minimal, production-ready example** showing how to build a chat application using Behest.

This demo teaches the **core patterns** developers need to integrate Behest into their own applications:
- User authentication
- JWT token minting
- Chat API integration
- CORS configuration

Perfect for learning how Behest works before building your own app!

---

## ✨ Features

✅ **Simple User Authentication** — In-memory store with 2 demo users

✅ **Behest Integration** — Backend mints JWTs and proxies chat requests

✅ **CORS Configuration** — Shows how to safely handle cross-origin requests

✅ **Production-Ready Code** — Includes error handling and logging

✅ **Well-Documented** — Detailed comments explaining each step

---

## 📋 Quick Start (3 minutes)

### 1. Get Your API Key and Base URL

- Go to https://behest.ai/dashboard/projects
- Click on your project
- Click "View API Keys"
- Copy your `BEHEST_API_KEY` (format: `behest_sk_live_xxx`)
- Copy your `BEHEST_BASE_URL` (Project Domain, format: `https://your-project-name.behest.app`)

### 2. Configure Environment

```bash
cp .env.example .env
nano .env
# Edit these two values:
# BEHEST_API_KEY=behest_sk_live_xxx
# BEHEST_BASE_URL=https://your-project-name.behest.app
```

**Where to find your values:**
- Go to https://behest.ai/dashboard/projects
- Click on your project
- Click "View API Keys"
- You'll see both `BEHEST_API_KEY` and `BEHEST_BASE_URL` (Project Domain)

**Note:** `dotenv` loads `.env` by default (not `.env.local`)
See **`ENV_SETUP.md`** for detailed configuration options.

### 3. Install & Run

```bash
npm install
npm start
```

Output:
```
╔═════════════════════════════════════════════════════════════════╗
║         Behest Chat Demo — Reference Implementation             ║
╚═════════════════════════════════════════════════════════════════╝

🚀 Server started:
   URL: http://localhost:3080
```

### 4. Open in Browser

Visit http://localhost:3080

**Test Users:**
- Username: `alice` | Password: `alice123`
- Username: `bob` | Password: `bob123`

Try chatting! 💬

---

## 🏗️ Architecture

### Request Flow

```
┌─────────────┐                          ┌──────────────────┐
│   Browser   │                          │   Behest Chat    │
│  (Frontend) │                          │    Demo Server   │
└──────┬──────┘                          └────────┬─────────┘
       │                                          │
       │  1. POST /api/login (alice/alice123)    │
       │ ─────────────────────────────────────► │
       │                                          │ Set session cookie
       │◄─────────────────────────────────────────│
       │                                          │
       │  2. POST /api/chat                       │
       │     { messages: [...] }                 │
       │ ─────────────────────────────────────► │
       │      + Cookie                           │
       │                                          │ 📌 STEP A: Mint JWT
       │                                          │   POST /auth/v1/auth/mint
       │                                          │   Authorization: Bearer {API_KEY}
       │                                          │
       │                                          │ ┌──────────────────┐
       │                                          │ │  Behest Backend  │
       │                                          │ └────────┬─────────┘
       │                                          │          │
       │                                          │◄─────────┤ Return JWT
       │                                          │
       │                                          │ 📌 STEP B: Call Chat API
       │                                          │   POST /v1/chat/completions
       │                                          │   Authorization: Bearer {JWT}
       │                                          │
       │                                          │ ┌──────────────────┐
       │                                          │ │  Behest Backend  │
       │                                          │ │  (LiteLLM)       │
       │                                          │ └────────┬─────────┘
       │                                          │          │
       │                                          │◄─────────┤ Return response
       │                                          │
       │  3. Response { content: "..." }         │
       │◄─────────────────────────────────────────│
       │                                          │
```

### Key Concepts

1. **API Key (Server-Side Only)** 🔐
   - Kept secret on your backend
   - Never exposed to frontend
   - Used to mint JWTs for users

2. **JWT Minting** 🎫
   - Backend calls `POST /auth/v1/auth/mint`
   - Converts session → Behest JWT
   - Valid for single request

3. **Chat Proxy** 💬
   - Frontend sends message to `/api/chat`
   - Backend mints JWT + calls Behest
   - Response returned to frontend

4. **Session Management** 🍪
   - httpOnly cookies keep users logged in
   - Backend validates session on each request
   - User ID used for JWT minting

---

## 📁 Project Structure

```
behest-chat-demo/
├── server.js              ← Core server (authentication, JWT minting, chat proxy)
├── package.json           ← Dependencies
├── public/
│   ├── index.html         ← Login form + chat UI
│   └── app.js             ← Frontend logic
├── .env.example           ← Template for environment variables
├── .env.local             ← Your local configuration (not committed)
├── .env.dev               ← Development environment
├── .env.prod              ← Production environment
├── ENV_SETUP.md           ← Environment configuration guide
└── README.md              ← This file
```

---

## 🔧 API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/login` | Login user (returns session cookie) |
| `POST` | `/api/logout` | Logout user |
| `GET` | `/api/me` | Get current user |

### Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/chat` | Send message to Behest (proxy) |

### Example: Chat Request

```bash
curl -X POST http://localhost:3080/api/chat \
  -H "Content-Type: application/json" \
  -b "sessionid=abc123" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "model": "gemini-2.5-flash"
  }'
```

Response:
```json
{
  "choices": [
    {
      "message": {
        "content": "Hi! How can I help you today?"
      }
    }
  ]
}
```

---

## 🎓 Learning Resources

### Understanding the Code

1. **Start here:** `server.js` (fully commented)
2. **Frontend:** `public/app.js` (how to call the API)
3. **Configuration:** `ENV_SETUP.md` (environment variables)

### Key Sections in server.js

- **Lines 1-60** — Setup and configuration
- **Lines 65-115** — Authentication endpoints
- **Lines 118-180** — JWT minting (core Behest integration!)
- **Lines 183-260** — Chat proxy (how to call Behest API)

### Production Checklist

Before deploying to production:

- [ ] Replace in-memory `USERS` with real database
- [ ] Use `bcryptjs` for password hashing
- [ ] Store `BEHEST_API_KEY` in secure vault
- [ ] Use production Behest instance URL
- [ ] Enable HTTPS only
- [ ] Add rate limiting
- [ ] Add request validation
- [ ] Configure proper CORS for your domain
- [ ] Set `NODE_ENV=production`
- [ ] Enable request logging

---

## 🐛 Troubleshooting

### "BEHEST_API_KEY not configured"
```bash
# Check .env.local exists and has the key
cat .env.local | grep BEHEST_API_KEY

# Should output: BEHEST_API_KEY=behest_sk_live_xxx
```

### "Behest mint failed: 401"
- API key is invalid or expired
- Try getting a new key from dashboard
- Check you're using the correct instance URL

### "Not authenticated"
- Login first with `/api/login`
- Make sure session cookie is being sent

### CORS errors
- Check `CORS_ORIGIN` in `.env.local` matches your frontend URL
- Example: If frontend is `http://localhost:3090`, set `CORS_ORIGIN=http://localhost:3090`

### Port already in use
```bash
# Use a different port
PORT=3081 npm start
```

---

## 📚 Next Steps

1. ✅ Run the demo locally
2. ✅ Understand the code flow
3. ✅ Customize the frontend (`public/app.js`)
4. ✅ Replace in-memory auth with your database
5. ✅ Deploy to production

---

## 📖 Documentation

- **`ENV_SETUP.md`** — Complete environment configuration guide
- **`server.js`** — Fully commented reference implementation
- **Behest Docs** — https://behest.ai/docs

---

## 📄 License

MIT — Feel free to use this as a reference for your own projects!

---

## 🤝 Contributing

Found a bug or want to improve the demo? Pull requests welcome!

**To improve this demo:**
1. Fork the repo
2. Make your changes
3. Submit a pull request

---

## ❓ Questions?

- Check the code comments in `server.js`
- Read `ENV_SETUP.md` for configuration help
- Visit https://behest.ai for more information

Happy coding! 🚀
