import { create } from "zustand";
import type { Message, Marker, Viewport, SurfaceUpdate, CardDefinition } from "@uiflow/types";

interface ConversationSlice {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sessionId: string;
  addMessage: (message: Message) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

interface MapSlice {
  viewport: Viewport;
  markers: Record<string, Marker>;
  selectedMarkerId: string | null;
  fitBoundsSignal: number;
  fitBoundsPadding: number;
  setViewport: (viewport: Viewport) => void;
  addMarkers: (markers: Marker[]) => void;
  removeMarkers: (ids: string[]) => void;
  setSelectedMarker: (id: string | null) => void;
  triggerFitBounds: (padding: number) => void;
}

interface PanelSlice {
  cards: CardDefinition[];
  isPanelOpen: boolean;
  setCards: (cards: CardDefinition[]) => void;
  clearPanel: () => void;
  setPanelOpen: (open: boolean) => void;
}

interface StoreActions {
  applySurfaceUpdate: (update: SurfaceUpdate) => void;
  getSurfaceSnapshot: () => import("@uiflow/types").SurfaceSnapshot;
}

type UIFlowStore = ConversationSlice & MapSlice & PanelSlice & StoreActions;

export const useUIFlowStore = create<UIFlowStore>((set, get) => ({
  // ─── Conversation ──────────────────────────────────────────────────────────
  messages: [],
  isLoading: false,
  error: null,
  sessionId: crypto.randomUUID(),

  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),
  setLoading: (loading) => set({ isLoading: loading }),
  setError:   (error)   => set({ error }),

  // ─── Map ──────────────────────────────────────────────────────────────────
  viewport: { center: [-98.5795, 39.8283], zoom: 4 },
  markers: {},
  selectedMarkerId: null,
  fitBoundsSignal: 0,
  fitBoundsPadding: 80,

  setViewport: (viewport) => set({ viewport }),

  addMarkers: (markers) =>
    set((s) => {
      const updated = { ...s.markers };
      markers.forEach((m) => (updated[m.id] = m));
      return { markers: updated };
    }),

  removeMarkers: (ids) =>
    set((s) => {
      if (ids.includes("*")) return { markers: {}, selectedMarkerId: null };
      const updated = { ...s.markers };
      ids.forEach((id) => delete updated[id]);
      return { markers: updated };
    }),

  setSelectedMarker: (id) => set({ selectedMarkerId: id }),

  triggerFitBounds: (padding) =>
    set((s) => ({ fitBoundsSignal: s.fitBoundsSignal + 1, fitBoundsPadding: padding })),

  // ─── Panel ────────────────────────────────────────────────────────────────
  cards: [],
  isPanelOpen: false,

  setCards: (cards) => set({ cards, isPanelOpen: cards.length > 0 }),
  clearPanel: ()    => set({ cards: [], isPanelOpen: false }),
  setPanelOpen: (open) => set({ isPanelOpen: open }),

  // ─── Cross-slice ───────────────────────────────────────────────────────────
  applySurfaceUpdate: (update) => {
    const s = get();
    if (update.surface === "map") {
      switch (update.op) {
        case "SET_VIEWPORT":
          s.setViewport(update.payload as unknown as Viewport);
          break;
        case "ADD_MARKERS":
          s.addMarkers((update.payload as { markers: Marker[] }).markers);
          break;
        case "REMOVE_MARKERS":
          s.removeMarkers((update.payload as { ids: string[] }).ids);
          break;
        case "FIT_BOUNDS":
          s.triggerFitBounds((update.payload["padding"] as number) ?? 80);
          break;
      }
    }
    if (update.surface === "panel") {
      switch (update.op) {
        case "RENDER_CARDS":
          s.setCards((update.payload as { cards: CardDefinition[] }).cards);
          break;
        case "CLEAR":
          s.clearPanel();
          break;
      }
    }
  },

  getSurfaceSnapshot: () => {
    const s = get();
    const markerList = Object.values(s.markers);
    return {
      map: {
        viewport:     s.viewport,
        markerCount:  markerList.length,
        markers:      markerList.slice(0, 5).map((m) => ({ id: m.id, label: m.label })),
        activeLayers: [],
        drawingActive: false,
      },
      panel: {
        contentType:       s.cards.length > 0 ? ("cards" as const) : ("empty" as const),
        itemCount:         s.cards.length,
        activeWorkflowStep: null,
      },
    };
  },
}));
