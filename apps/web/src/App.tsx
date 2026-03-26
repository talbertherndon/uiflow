import { useState } from "react";
import { MapSurface } from "./surfaces/MapSurface.js";
import { ChatPanel } from "./components/chat/ChatPanel.js";

export function App() {
  const [chatOpen, setChatOpen] = useState(true);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-950 text-white">

      {/* Map — fills all remaining space */}
      <div className="relative flex-1 min-w-0">
        <MapSurface />

        {/* Floating top-left wordmark */}
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2 px-3 py-1.5 glass rounded-xl select-none">
          <div className="w-2 h-2 rounded-full bg-accent-500" />
          <span className="text-sm font-semibold tracking-wide text-white/90">UIFlow</span>
        </div>

        {/* Toggle chat button — bottom right of map, mobile-friendly */}
        <button
          onClick={() => setChatOpen((o) => !o)}
          className="absolute bottom-5 right-5 z-10 md:hidden flex items-center gap-2 px-4 py-2.5 glass rounded-2xl text-sm font-medium text-white/80 glass-hover shadow-lg"
        >
          {chatOpen ? "Hide chat" : "Open chat"}
        </button>
      </div>

      {/* Chat panel — sidebar on desktop, drawer on mobile */}
      <div
        className={[
          "flex-shrink-0 flex flex-col border-l border-white/[0.06]",
          "bg-surface-950",
          // Desktop: always visible, fixed width
          "md:w-[380px] md:translate-x-0 md:relative md:flex",
          // Mobile: full-width overlay, toggled
          chatOpen
            ? "fixed inset-0 z-20 flex md:static"
            : "hidden md:flex",
        ].join(" ")}
      >
        <ChatPanel onClose={() => setChatOpen(false)} />
      </div>
    </div>
  );
}
