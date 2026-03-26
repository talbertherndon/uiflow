import { useUIFlowStore } from "../store/index.js";
import { ResultCard } from "../components/panel/ResultCard.js";

export function PanelSurface() {
  const cards       = useUIFlowStore((s) => s.cards);
  const isPanelOpen = useUIFlowStore((s) => s.isPanelOpen);
  const clearPanel  = useUIFlowStore((s) => s.clearPanel);

  if (!isPanelOpen || cards.length === 0) return null;

  return (
    <div className="absolute top-0 left-0 h-full z-10 flex flex-col w-[300px] pointer-events-none">
      {/* Panel card */}
      <div className="pointer-events-auto m-4 flex flex-col bg-surface-900/95 backdrop-blur-xl border border-white/[0.07] rounded-2xl shadow-2xl overflow-hidden max-h-[calc(100vh-2rem)] animate-slide-up">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] flex-shrink-0">
          <div>
            <p className="text-xs font-semibold text-white/80 tracking-wide">Results</p>
            <p className="text-[10px] text-white/30 mt-0.5">{cards.length} place{cards.length !== 1 ? "s" : ""} found</p>
          </div>
          <button
            onClick={clearPanel}
            className="p-1.5 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
            aria-label="Close results"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Cards list */}
        <div className="overflow-y-auto flex-1 p-2 flex flex-col gap-1">
          {cards.map((card, i) => (
            <ResultCard key={card.id} card={card} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
