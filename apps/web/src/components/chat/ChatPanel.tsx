import { useRef, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useUIFlowStore } from "../../store/index.js";
import { sendMessage } from "../../lib/conversation.js";
import { MessageItem } from "./MessageItem.js";

interface ChatPanelProps {
  onClose: () => void;
}

const SUGGESTIONS = [
  "Show me the Eiffel Tower",
  "Find coffee shops in Austin",
  "Zoom to Tokyo",
];

export function ChatPanel({ onClose }: ChatPanelProps) {
  const messages   = useUIFlowStore((s) => s.messages);
  const isLoading  = useUIFlowStore((s) => s.isLoading);
  const error      = useUIFlowStore((s) => s.error);
  const [input, setInput] = useState("");
  const bottomRef  = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  const submit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    await sendMessage(trimmed);
  };

  const handleSubmit = (e?: FormEvent) => { e?.preventDefault(); void submit(input); };
  const handleKey    = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(input); }
  };

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
        <div>
          <h1 className="text-sm font-semibold text-white tracking-wide">AI Assistant</h1>
          <p className="text-xs text-white/30 mt-0.5">Map-aware · Outcome-driven</p>
        </div>
        <button
          onClick={onClose}
          className="md:hidden p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-5 flex flex-col gap-4">

        {messages.length === 0 && (
          <div className="flex flex-col gap-6 my-auto animate-fade-in">
            {/* Empty state */}
            <div className="text-center">
              <div className="w-10 h-10 rounded-2xl bg-accent-600/20 border border-accent-500/20 flex items-center justify-center mx-auto mb-3">
                <div className="w-3 h-3 rounded-full bg-accent-500" />
              </div>
              <p className="text-sm text-white/50 font-medium">Ask me about any location</p>
              <p className="text-xs text-white/25 mt-1">I can control the map, find places, and guide you</p>
            </div>

            {/* Suggestion chips */}
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void submit(s)}
                  className="w-full text-left px-4 py-3 rounded-xl glass glass-hover text-sm text-white/60 hover:text-white/90 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} />
        ))}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex items-start gap-3 animate-fade-in">
            <div className="w-7 h-7 rounded-full bg-accent-600/20 border border-accent-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
              <div className="w-2 h-2 rounded-full bg-accent-500" />
            </div>
            <div className="px-4 py-3 glass rounded-2xl rounded-tl-sm">
              <div className="flex gap-1.5 items-center h-4">
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-white/40" />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-white/40" />
                <span className="typing-dot w-1.5 h-1.5 rounded-full bg-white/40" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="px-4 py-3 rounded-xl bg-red-950/50 border border-red-500/20 text-xs text-red-400 animate-fade-in">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2 border-t border-white/[0.06]">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <div className="flex-1 glass rounded-2xl px-4 py-3 flex items-end gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask about a location…"
              rows={1}
              disabled={isLoading}
              className="flex-1 resize-none bg-transparent text-sm text-white/90 placeholder-white/25 outline-none leading-relaxed min-h-[20px] max-h-[120px] disabled:opacity-50"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="w-10 h-10 rounded-xl bg-accent-600 hover:bg-accent-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 transition-colors shadow-lg shadow-accent-600/20"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L8 14M8 2L4 6M8 2L12 6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </form>
        <p className="text-[10px] text-white/15 text-center mt-2">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
