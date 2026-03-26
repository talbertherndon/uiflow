import { useUIFlowStore } from "../../store/index.js";
import type { CardDefinition } from "@uiflow/types";

interface Props {
  card: CardDefinition;
  index: number;
}

// Category → emoji
const CATEGORY_ICON: Record<string, string> = {
  restaurant: "🍽️", food: "🍽️", cafe: "☕", coffee: "☕",
  bar: "🍸", bakery: "🥐", pizza: "🍕",
  hotel: "🏨", lodging: "🏨",
  park: "🌿", nature: "🌿",
  museum: "🏛️", art: "🎨",
  shop: "🛍️", store: "🛍️", shopping: "🛍️",
  pharmacy: "💊", hospital: "🏥",
  gym: "💪", fitness: "💪",
  default: "📍",
};

function getIcon(category: string): string {
  const lower = category.toLowerCase();
  for (const [key, icon] of Object.entries(CATEGORY_ICON)) {
    if (lower.includes(key)) return icon;
  }
  return CATEGORY_ICON["default"]!;
}

export function ResultCard({ card, index }: Props) {
  const selectedMarkerId = useUIFlowStore((s) => s.selectedMarkerId);
  const setSelectedMarker = useUIFlowStore((s) => s.setSelectedMarker);
  const isSelected = selectedMarkerId === card.markerId;

  const handleClick = () => {
    setSelectedMarker(isSelected ? null : (card.markerId ?? card.id));
  };

  return (
    <button
      onClick={handleClick}
      className={[
        "w-full text-left px-3 py-3 rounded-xl transition-all duration-150 group",
        isSelected
          ? "bg-accent-600/20 border border-accent-500/30"
          : "hover:bg-white/[0.05] border border-transparent",
      ].join(" ")}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={[
          "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-sm",
          isSelected ? "bg-accent-600/30" : "bg-white/[0.06]",
        ].join(" ")}>
          {getIcon(card.subtitle ?? "")}
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className={[
            "text-sm font-medium truncate leading-tight",
            isSelected ? "text-white" : "text-white/80",
          ].join(" ")}>
            {card.title}
          </p>
          {card.subtitle && (
            <p className="text-[10px] text-white/35 mt-0.5 capitalize">{card.subtitle}</p>
          )}
          {card.body && (
            <p className="text-[11px] text-white/40 mt-1 leading-snug line-clamp-2">{card.body}</p>
          )}
        </div>

        {/* Selection indicator */}
        {isSelected && (
          <div className="w-1.5 h-1.5 rounded-full bg-accent-400 flex-shrink-0 mt-1.5" />
        )}
      </div>
    </button>
  );
}
