import { create } from "zustand";
import type { Message, Marker, Viewport, SurfaceUpdate } from "@uiflow/types";

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
  fitBoundsSignal: number; // increments to trigger fitBounds imperatively
  fitBoundsPadding: number;
  setViewport: (viewport: Viewport) => void;
  addMarkers: (markers: Marker[]) => void;
  removeMarkers: (ids: string[]) => void;
  triggerFitBounds: (padding: number) => void;
}

interface StoreActions {
  applySurfaceUpdate: (update: SurfaceUpdate) => void;
  getSurfaceSnapshot: () => import("@uiflow/types").SurfaceSnapshot;
}

type UIFlowStore = ConversationSlice & MapSlice & StoreActions;

export const useUIFlowStore = create<UIFlowStore>((set, get) => ({
  // ─── Conversation ──────────────────────────────────────────────────────────
  messages: [],
  isLoading: false,
  error: null,
  sessionId: crypto.randomUUID(),

  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  // ─── Map ──────────────────────────────────────────────────────────────────
  viewport: { center: [-98.5795, 39.8283], zoom: 4 },
  markers: {},
  fitBoundsSignal: 0,
  fitBoundsPadding: 60,

  setViewport: (viewport) => set({ viewport }),

  addMarkers: (markers) =>
    set((s) => {
      const updated = { ...s.markers };
      markers.forEach((m) => (updated[m.id] = m));
      return { markers: updated };
    }),

  removeMarkers: (ids) =>
    set((s) => {
      const updated = { ...s.markers };
      if (ids.includes("*")) return { markers: {} };
      ids.forEach((id) => delete updated[id]);
      return { markers: updated };
    }),

  triggerFitBounds: (padding) =>
    set((s) => ({ fitBoundsSignal: s.fitBoundsSignal + 1, fitBoundsPadding: padding })),

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
          s.triggerFitBounds((update.payload["padding"] as number) ?? 60);
          break;
      }
    }
  },

  getSurfaceSnapshot: () => {
    const s = get();
    const markerList = Object.values(s.markers);
    return {
      map: {
        viewport: s.viewport,
        markerCount: markerList.length,
        markers: markerList.slice(0, 5).map((m) => ({ id: m.id, label: m.label })),
        activeLayers: [],
        drawingActive: false,
      },
      panel: {
        contentType: "empty" as const,
        itemCount: 0,
        activeWorkflowStep: null,
      },
    };
  },
}));
