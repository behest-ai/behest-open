"use client";

import { useChat } from "ai/react";

export default function ChatClient() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, stop } =
    useChat({ api: "/api/chat" });

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "1rem", fontFamily: "sans-serif" }}>
      <h2>Behest Chat</h2>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: "1rem", minHeight: 300, marginBottom: "1rem" }}>
        {messages.length === 0 && (
          <p style={{ color: "#999" }}>Send a message to start chatting.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} style={{ marginBottom: "0.75rem" }}>
            <b>{m.role === "user" ? "You" : "Assistant"}:</b> {m.content}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.5rem" }}>
        <input
          value={input}
          onChange={handleInputChange}
          placeholder="Type a message…"
          disabled={isLoading}
          style={{ flex: 1, padding: "0.5rem", borderRadius: 6, border: "1px solid #ccc" }}
        />
        <button type="submit" disabled={isLoading || !input.trim()} style={{ padding: "0.5rem 1rem" }}>
          Send
        </button>
        {isLoading && (
          <button type="button" onClick={stop} style={{ padding: "0.5rem 1rem" }}>
            Stop
          </button>
        )}
      </form>
    </div>
  );
}
