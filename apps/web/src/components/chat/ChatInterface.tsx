import { useRef, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useUIFlowStore } from "../../store/index.js";
import { sendMessage } from "../../lib/conversation.js";

export function ChatInterface() {
  const messages = useUIFlowStore((s) => s.messages);
  const isLoading = useUIFlowStore((s) => s.isLoading);
  const error = useUIFlowStore((s) => s.error);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    await sendMessage(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>UIFlow</span>
        <span style={styles.headerSub}>AI Map Assistant</span>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.empty}>
            <p style={styles.emptyTitle}>Ask me anything about a location.</p>
            <p style={styles.emptyHint}>Try: "Show me Central Park" or "Find coffee shops in Austin"</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              ...styles.bubble,
              ...(msg.role === "user" ? styles.userBubble : styles.aiBubble),
            }}
          >
            {msg.content && <p style={styles.bubbleText}>{msg.content}</p>}
            {msg.surfaceUpdates && msg.surfaceUpdates.length > 0 && (
              <div style={styles.updatePills}>
                {msg.surfaceUpdates.map((u, i) => (
                  <span key={i} style={styles.pill}>
                    {u.op.toLowerCase().replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div style={{ ...styles.bubble, ...styles.aiBubble }}>
            <div style={styles.typing}>
              <span style={styles.dot} />
              <span style={{ ...styles.dot, animationDelay: "0.2s" }} />
              <span style={{ ...styles.dot, animationDelay: "0.4s" }} />
            </div>
          </div>
        )}

        {error && (
          <div style={styles.error}>{error}</div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} style={styles.form}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about a location..."
          style={styles.textarea}
          rows={1}
          disabled={isLoading}
        />
        <button type="submit" disabled={isLoading || !input.trim()} style={styles.sendBtn}>
          ↑
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "#0f1117",
    color: "#e8eaf0",
    borderLeft: "1px solid #1e2130",
  },
  header: {
    display: "flex",
    flexDirection: "column",
    padding: "16px 18px 12px",
    borderBottom: "1px solid #1e2130",
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color: "#fff",
  },
  headerSub: {
    fontSize: 11,
    color: "#6b7280",
    marginTop: 2,
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  empty: {
    margin: "auto",
    textAlign: "center",
    padding: "24px 16px",
  },
  emptyTitle: {
    color: "#9ca3af",
    fontSize: 14,
    margin: "0 0 6px",
  },
  emptyHint: {
    color: "#4b5563",
    fontSize: 12,
    margin: 0,
    fontStyle: "italic",
  },
  bubble: {
    maxWidth: "88%",
    padding: "10px 13px",
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 1.55,
  },
  userBubble: {
    alignSelf: "flex-end",
    background: "#2563eb",
    color: "#fff",
    borderBottomRightRadius: 3,
  },
  aiBubble: {
    alignSelf: "flex-start",
    background: "#1a1f2e",
    color: "#d1d5db",
    borderBottomLeftRadius: 3,
  },
  bubbleText: {
    margin: 0,
  },
  updatePills: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 7,
  },
  pill: {
    fontSize: 10,
    padding: "2px 7px",
    borderRadius: 99,
    background: "#1e3a5f",
    color: "#60a5fa",
    fontFamily: "monospace",
  },
  typing: {
    display: "flex",
    gap: 5,
    alignItems: "center",
    height: 18,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#4b5563",
    animation: "pulse 1s infinite ease-in-out",
  },
  error: {
    background: "#2d1b1b",
    color: "#f87171",
    fontSize: 12,
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid #7f1d1d",
  },
  form: {
    display: "flex",
    gap: 8,
    padding: "12px 14px",
    borderTop: "1px solid #1e2130",
    flexShrink: 0,
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    resize: "none",
    background: "#1a1f2e",
    border: "1px solid #2a3045",
    borderRadius: 10,
    color: "#e8eaf0",
    fontSize: 13,
    padding: "9px 12px",
    outline: "none",
    fontFamily: "inherit",
    lineHeight: 1.5,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    background: "#2563eb",
    color: "#fff",
    border: "none",
    fontSize: 18,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
};
