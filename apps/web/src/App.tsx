import { useState } from "react";
import { MapSurface } from "./surfaces/MapSurface.js";
import { PanelSurface } from "./surfaces/PanelSurface.js";
import { ChatPanel } from "./components/chat/ChatPanel.js";

export function App() {
  const [chatOpen, setChatOpen] = useState(true);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-950 text-white">

      {/* Map + floating overlays */}
      <div className="relative flex-1 min-w-0">
        <MapSurface />

        {/* Floating wordmark */}
        <div className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1.5 bg-surface-900/80 backdrop-blur-xl border border-white/[0.07] rounded-xl select-none shadow-lg">
          <div className="w-2 h-2 rounded-full bg-accent-500" />
          <span className="text-sm font-semibold tracking-wide text-white/90">UIFlow</span>
        </div>

        {/* Results panel — floats over left side of map */}
        <PanelSurface />

        {/* Mobile chat toggle */}
        <button
          onClick={() => setChatOpen((o) => !o)}
          className="absolute bottom-5 right-5 z-20 md:hidden flex items-center gap-2 px-4 py-2.5 bg-surface-900/90 backdrop-blur-xl border border-white/[0.07] rounded-2xl text-sm font-medium text-white/70 hover:text-white transition-colors shadow-lg"
        >
          {chatOpen ? "Hide chat" : "Chat"}
        </button>
      </div>

      {/* Chat panel */}
      <div
        className={[
          "flex-shrink-0 flex flex-col border-l border-white/[0.06] bg-surface-950",
          "md:w-[360px] md:relative md:flex",
          chatOpen ? "fixed inset-0 z-30 flex md:static" : "hidden md:flex",
        ].join(" ")}
      >
        <ChatPanel onClose={() => setChatOpen(false)} />
      </div>
    </div>
  );
}
