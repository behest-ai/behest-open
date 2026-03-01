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
    const r = await fetch(`${API}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ messages }),
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
  show(loginSection);
  hide(chatSection);
  usernameInput.value = "";
  passwordInput.value = "";
});

checkAuth().then((user) => {
  if (user) {
    hide(loginSection);
    show(chatSection);
    userDisplay.textContent = user.username;
  }
});
