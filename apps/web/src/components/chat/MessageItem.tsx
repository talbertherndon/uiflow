import type { Message } from "@uiflow/types";

interface Props {
  message: Message;
}

const OP_LABELS: Record<string, string> = {
  SET_VIEWPORT:    "flew to location",
  ADD_MARKERS:     "added markers",
  REMOVE_MARKERS:  "cleared markers",
  FIT_BOUNDS:      "fit map bounds",
  RENDER_CARDS:    "showed cards",
  RENDER_FORM:     "showed form",
  CLEAR:           "cleared panel",
};

export function MessageItem({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex items-start gap-3 animate-slide-up ${isUser ? "flex-row-reverse" : ""}`}>

      {/* Avatar */}
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-accent-600/20 border border-accent-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <div className="w-2 h-2 rounded-full bg-accent-500" />
        </div>
      )}

      <div className={`flex flex-col gap-1.5 max-w-[82%] ${isUser ? "items-end" : "items-start"}`}>
        {/* Bubble */}
        {message.content && (
          <div
            className={[
              "px-4 py-3 rounded-2xl text-sm leading-relaxed",
              isUser
                ? "bg-accent-600 text-white rounded-tr-sm shadow-lg shadow-accent-600/20"
                : "glass text-white/80 rounded-tl-sm",
            ].join(" ")}
          >
            {message.content}
          </div>
        )}

        {/* Surface update pills */}
        {message.surfaceUpdates && message.surfaceUpdates.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.surfaceUpdates.map((u, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent-600/10 border border-accent-500/20 text-[10px] font-medium text-accent-400"
              >
                <span className="w-1 h-1 rounded-full bg-accent-500" />
                {OP_LABELS[u.op] ?? u.op.toLowerCase().replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
