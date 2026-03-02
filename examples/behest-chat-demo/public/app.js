const loginSection = document.getElementById("login-section");
const chatSection = document.getElementById("chat-section");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const userDisplay = document.getElementById("user-name");
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send-btn");
const chatError = document.getElementById("chat-error");
const logoutBtn = document.getElementById("logout-btn");

const API = ""; // same origin

// Behest configuration and JWT token (obtained after login)
let behestConfig = null;
let behestToken = null;

function hide(el) {
  el.classList.add("hidden");
}
function show(el) {
  el.classList.remove("hidden");
}
function showError(el, msg) {
  el.textContent = msg || "";
  el.classList.toggle("hidden", !msg);
}

async function checkAuth() {
  try {
    const r = await fetch(`${API}/api/me`, { credentials: "include" });
    if (r.ok) {
      const { user } = await r.json();
      return user;
    }
  } catch (_) {}
  return null;
}

function renderMessage(role, content) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.innerHTML = `<span class="role">${role}</span><div>${escapeHtml(content)}</div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

loginBtn.addEventListener("click", async () => {
  hide(loginError);
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  if (!username || !password) {
    showError(loginError, "Enter username and password");
    return;
  }
  loginBtn.disabled = true;
  try {
    // Step 1: Authenticate user and create session
    const r = await fetch(`${API}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (!r.ok) {
      showError(loginError, data.error || "Login failed");
      return;
    }

    // Step 2: Get Behest configuration (base URL)
    const configRes = await fetch(`${API}/api/config`);
    if (!configRes.ok) {
      showError(loginError, "Failed to get Behest config");
      return;
    }
    behestConfig = await configRes.json();

    // Step 3: Get Behest JWT token for this user
    const tokenRes = await fetch(`${API}/api/get-token`, {
      method: "POST",
      credentials: "include",
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      showError(loginError, tokenData.error || "Failed to get Behest token");
      return;
    }
    behestToken = tokenData.access_token;

    // Switch to chat UI
    hide(loginSection);
    show(chatSection);
    userDisplay.textContent = data.user.username;
    messagesEl.innerHTML = "";
    inputEl.focus();
  } finally {
    loginBtn.disabled = false;
  }
});

sendBtn.addEventListener("click", sendMessage);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

async function sendMessage() {
  const text = inputEl.value.trim();
  if (!text) return;
  hide(chatError);
  inputEl.value = "";
  renderMessage("user", text);

  const messages = Array.from(messagesEl.querySelectorAll(".msg")).map((m) => ({
    role: m.classList.contains("user") ? "user" : "assistant",
    content: m.querySelector("div").textContent,
  }));

  sendBtn.disabled = true;
  try {
    // Direct call to Behest API using minted JWT
    // The backend provides the token via /api/get-token
    // and the base URL via /api/config
    if (!behestToken || !behestConfig) {
      showError(chatError, "Not authenticated with Behest");
      return;
    }

    const r = await fetch(`${behestConfig.behest_base_url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${behestToken}`,
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages,
        max_tokens: 256,
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      showError(chatError, data.error || "Chat failed");
      return;
    }
    const content = data.choices?.[0]?.message?.content ?? "(no response)";
    renderMessage("assistant", content);
  } catch (e) {
    showError(chatError, e.message || "Network error");
  } finally {
    sendBtn.disabled = false;
  }
}

logoutBtn.addEventListener("click", async () => {
  await fetch(`${API}/api/logout`, { method: "POST", credentials: "include" });
  behestToken = null;
  behestConfig = null;
  show(loginSection);
  hide(chatSection);
  usernameInput.value = "";
  passwordInput.value = "";
});

checkAuth().then(async (user) => {
  if (user) {
    // Fetch config and token for already-authenticated users (e.g., page refresh)
    try {
      const configRes = await fetch(`${API}/api/config`);
      if (configRes.ok) {
        behestConfig = await configRes.json();
      }
      const tokenRes = await fetch(`${API}/api/get-token`, {
        method: "POST",
        credentials: "include",
      });
      if (tokenRes.ok) {
        const tokenData = await tokenRes.json();
        behestToken = tokenData.access_token;
      }
    } catch (_) {
      // If token fetch fails, user can still see chat UI but chat will fail
      // This allows page reload to work even if token fetch temporarily fails
    }

    hide(loginSection);
    show(chatSection);
    userDisplay.textContent = user.username;
  }
});
