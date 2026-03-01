#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Behest Chat Demo — Express.js Backend Reference Implementation
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This is a simple reference implementation showing how to:
 * 1. Authenticate users (in-memory for demo; use database in production)
 * 2. Mint Behest JWTs server-side using your API key
 * 3. Call Behest chat completions API on behalf of users
 * 4. Proxy requests from frontend to Behest API
 *
 * Key Concepts:
 * - BEHEST_API_KEY: Your private API key (server-side only, never expose to client)
 * - User Session: Keep user authenticated locally (httpOnly cookie)
 * - JWT Minting: Convert session → Behest JWT for API calls
 * - Proxy Pattern: Backend handles token minting and proxies chat requests
 *
 * Test Users: alice/alice123, bob/bob123 (demo only)
 *
 * Production Checklist:
 * ✅ Replace in-memory USERS with real database
 * ✅ Use bcryptjs or similar for password hashing
 * ✅ Move BEHEST_API_KEY to secure secret management
 * ✅ Add rate limiting and request validation
 * ✅ Enable HTTPS only in production
 * ✅ Add comprehensive error logging
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import session from "express-session";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Configuration ───────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || "3080", 10);
const BEHEST_BASE = process.env.BEHEST_BASE_URL || "https://dev.internal.behest.ai";
const BEHEST_API_KEY = process.env.BEHEST_API_KEY;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3080";
// ─────────────────────────────────────────────────────────────────────────────

// Demo: In-memory user store
// In production: Replace with database (PostgreSQL, MongoDB, etc.)
// Password hashing: Use bcryptjs or similar in production
const USERS = new Map([
  ["alice", { password: "alice123", id: "alice" }],
  ["bob", { password: "bob123", id: "bob" }],
]);

const app = express();

// CORS: allow frontend origin (showcases CORS config)
app.use(
  cors({
    origin: CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(",").map((o) => o.trim()),
    credentials: true,
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "demo-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
  })
);

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

// ═════════════════════════════════════════════════════════════════════════════
// AUTHENTICATION ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════════
// In this demo: Simple in-memory auth with httpOnly session cookies
// In production: Use database + bcryptjs password hashing + secure session store
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Middleware: Check if user has active session
 * Returns 401 if not authenticated
 */
function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

/**
 * POST /api/login
 * Authenticate user and create session
 *
 * Request: { username: string, password: string }
 * Response: { user: { id, username } }
 * Error: 400 (missing fields), 401 (invalid credentials)
 *
 * Demo credentials: alice/alice123, bob/bob123
 */
app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }

  // Demo: Check against in-memory user store
  const user = USERS.get(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  // Create session (httpOnly cookie is set automatically by express-session)
  req.session.user = { id: user.id, username };
  res.json({ user: { id: user.id, username } });
});

/**
 * POST /api/logout
 * Destroy user session
 *
 * Response: { ok: true }
 */
app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

/**
 * GET /api/me
 * Get current authenticated user
 *
 * Response: { user: { id, username } }
 * Error: 401 (not authenticated)
 */
app.get("/api/me", (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json({ user: req.session.user });
});

// ═════════════════════════════════════════════════════════════════════════════
// CHAT ENDPOINT — Behest Integration
// ═════════════════════════════════════════════════════════════════════════════
// This is the core of the Behest integration showing:
// 1. JWT Minting: Use your BEHEST_API_KEY to mint a JWT for this user
// 2. Token Passing: Pass the JWT to Behest API to call chat completions
// 3. Proxy Pattern: Backend handles all Behest authentication
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/chat
 * Call Behest chat completions API
 *
 * This endpoint demonstrates the complete flow:
 * 1. Verify user is authenticated (middleware)
 * 2. Mint a Behest JWT using your API key
 * 3. Call Behest chat API with the minted JWT
 * 4. Return response to frontend
 *
 * Request: {
 *   messages: [
 *     { role: "user", content: "Hello" },
 *     { role: "assistant", content: "Hi there!" }
 *   ],
 *   model?: "gemini-2.5-flash"  // optional, defaults to gemini-2.5-flash
 * }
 *
 * Response: Behest API response with assistant message
 * Error: 400 (bad request), 401 (not authenticated), 500 (Behest API error)
 *
 * KEY SECURITY CONCEPT:
 * - BEHEST_API_KEY is kept server-side only (never exposed to frontend)
 * - Frontend sends messages to /api/chat
 * - Backend mints JWT and calls Behest on behalf of user
 * - This way, users never need to know about API keys
 */
app.post("/api/chat", requireAuth, async (req, res) => {
  // Validate API key is configured
  if (!BEHEST_API_KEY) {
    return res.status(500).json({
      error: "BEHEST_API_KEY not configured. Set it in .env",
    });
  }

  // Parse and validate request
  const { messages, model } = req.body || {};
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }

  try {
    // ─── STEP 1: Mint Behest JWT ──────────────────────────────────────────
    // Use your private API key to mint a JWT for this user
    // This JWT will be used to call Behest APIs on behalf of the user
    console.log(`[Behest] Minting JWT for user: ${req.session.user.id}`);

    const mintRes = await fetch(`${BEHEST_BASE}/auth/v1/auth/mint`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BEHEST_API_KEY}`,  // Your API key (server-side)
      },
      body: JSON.stringify({
        user_id: req.session.user.id,  // User ID from session
        role: "regular",                 // User role (can be admin, regular, etc.)
      }),
    });

    if (!mintRes.ok) {
      const err = await mintRes.text();
      console.error(`[Behest] Mint failed: ${mintRes.status} - ${err}`);
      return res.status(mintRes.status).json({
        error: `Behest mint failed: ${err}`,
      });
    }

    const { access_token } = await mintRes.json();
    if (!access_token) {
      console.error(`[Behest] Mint response missing access_token`);
      return res.status(500).json({ error: "Behest mint: no token" });
    }

    console.log(`[Behest] JWT minted successfully`);

    // ─── STEP 2: Call Behest Chat API ─────────────────────────────────────
    // Use the minted JWT to call Behest chat completions
    console.log(`[Behest] Calling /v1/chat/completions with ${messages.length} messages`);

    const chatRes = await fetch(`${BEHEST_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access_token}`,  // Minted JWT (valid for this request)
      },
      body: JSON.stringify({
        model: model || "gemini-2.5-flash",
        messages,
        max_tokens: 256,
      }),
    });

    if (!chatRes.ok) {
      const err = await chatRes.text();
      console.error(`[Behest] Chat API failed: ${chatRes.status} - ${err}`);
      return res.status(chatRes.status).json({
        error: `Behest chat failed: ${err}`,
      });
    }

    const chatJson = await chatRes.json();
    console.log(`[Behest] Chat API response received`);

    // ─── Return response to frontend ───────────────────────────────────────
    res.json(chatJson);
  } catch (error) {
    console.error(`[Behest] Unexpected error:`, error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═════════════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log("\n");
  console.log("╔═════════════════════════════════════════════════════════════════╗");
  console.log("║         Behest Chat Demo — Reference Implementation             ║");
  console.log("╚═════════════════════════════════════════════════════════════════╝");
  console.log("\n");

  console.log("🚀 Server started:");
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`   Open http://localhost:${PORT} in your browser`);
  console.log("\n");

  console.log("👤 Test Users (demo only):");
  console.log("   alice / alice123");
  console.log("   bob / bob123");
  console.log("\n");

  console.log("🔌 Configuration:");
  console.log(`   Behest Base URL: ${BEHEST_BASE}`);
  console.log(`   CORS Origin: ${CORS_ORIGIN}`);
  console.log(`   API Key Status: ${BEHEST_API_KEY ? "✅ Configured" : "❌ NOT CONFIGURED"}`);
  console.log("\n");

  if (!BEHEST_API_KEY) {
    console.log("⚠️  WARNING: BEHEST_API_KEY not set!");
    console.log("   Chat will fail until you configure it in .env");
    console.log("   See .env.example or ENV_SETUP.md for details");
    console.log("\n");
  }

  console.log("📚 Documentation:");
  console.log("   • README.md — Overview and quick start");
  console.log("   • ENV_SETUP.md — Environment configuration guide");
  console.log("   • This file (server.js) — Full implementation details");
  console.log("   • public/ — Frontend HTML/CSS/JS");
  console.log("\n");

  console.log("🔗 API Endpoints:");
  console.log("   POST   /api/login   — Authenticate user");
  console.log("   POST   /api/logout  — End session");
  console.log("   GET    /api/me      — Get current user");
  console.log("   POST   /api/chat    — Call Behest chat (proxy)");
  console.log("\n");
});
