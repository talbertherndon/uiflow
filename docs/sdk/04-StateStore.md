# StateStore

## What It Is

The StateStore is the **single source of truth for all client-side state** in UIFlow. Every piece of information that drives the UI — the conversation history, what's on the map, what's in the panel, what workflow is active — lives here and only here.

No component reads from two places. The map does not maintain its own internal state that differs from the store. The panel does not track its own content list independently. Everything is in the store, and the UI is just a projection of it.

This architecture makes the system predictable: if you know the contents of the store, you can perfectly reconstruct what the user sees on screen at any moment.

---

## Why Zustand

Zustand is used over Redux or Context API for three reasons:
1. **No boilerplate** — no reducers, action creators, or dispatchers; just functions that mutate slices directly
2. **TypeScript-first** — stores are fully typed with zero ceremony
3. **Selective subscriptions** — components subscribe to only the slice they need, avoiding unnecessary re-renders (critical for a map that re-renders every frame)

---

## State Slices

The store is organized into four slices. Each slice is independent — a surface controller only reads its own slice.

---

### ConversationState

Everything related to the chat interface.

```typescript
interface ConversationState {
  messages: Message[];          // Full history shown in MessageList
  streamingMessage: string;     // Text being streamed in real-time (shown as partial bubble)
  isLoading: boolean;           // True while awaiting AI response
  error: string | null;         // Last error message, cleared on next send
  sessionId: string;            // Ties this client to a server-side session
}
```

**Key behaviors:**
- `messages` is append-only during a session. Messages are never mutated after being committed.
- `streamingMessage` is a separate buffer so the message list doesn't flicker during streaming. When the stream ends, `streamingMessage` is committed to `messages` and cleared.
- `error` replaces the previous error on each failure. It is not an array — only the most recent error is shown.

---

### MapState

Everything the map surface needs to render.

```typescript
interface MapState {
  viewport: Viewport;                    // Current center, zoom, bearing, pitch
  markers: Record<string, Marker>;       // Keyed by ID for O(1) add/remove
  activeLayers: string[];                // Visible Mapbox layer IDs
  sources: Record<string, MapSource>;    // Loaded GeoJSON or tile sources
  drawingState: DrawingState | null;     // null = not drawing; object = active draw mode
  selectedMarkerId: string | null;       // For highlighting a marker from the panel
}

interface Viewport {
  center: [number, number]; // [lng, lat]
  zoom: number;
  bearing?: number;         // Rotation in degrees
  pitch?: number;           // Tilt in degrees (0 = top-down)
}

interface Marker {
  id: string;
  coordinates: [number, number];
  label: string;
  color?: string;
  metadata?: Record<string, unknown>; // Arbitrary data passed back on click
}

interface DrawingState {
  mode: "polygon" | "line" | "point";
  features: GeoJSON.Feature[];  // Completed features so far
  isActive: boolean;
}
```

**Key behaviors:**
- Markers are stored as a `Record<id, Marker>` for constant-time updates. Claude can add/remove individual markers by ID without touching the rest.
- `selectedMarkerId` is set when the user clicks a panel card. The `MapSurface` watches this and applies a visual highlight to the corresponding marker.
- `drawingState` being `null` vs. populated is how the map knows whether to render the drawing toolbar.

---

### PanelState

Everything the side panel needs to render.

```typescript
interface PanelState {
  content: PanelContent[];         // Ordered list of rendered items
  isVisible: boolean;              // Panel can be collapsed/hidden
  activeWorkflow: WorkflowStep | null; // Non-null when a workflow is in progress
}

type PanelContent =
  | { type: "cards";   items: CardDefinition[] }
  | { type: "form";    schema: JSONSchema; values: Record<string, unknown> }
  | { type: "filters"; fields: FilterField[]; values: Record<string, unknown> }
  | { type: "table";   columns: ColumnDef[]; rows: unknown[] }
  | { type: "text";    markdown: string }
  | { type: "custom";  componentName: string; props: Record<string, unknown> };

interface WorkflowStep {
  workflowId: string;
  stepId: string;
  stepIndex: number;
  totalSteps: number;
  collectedData: Record<string, unknown>;
  prompt: string; // Shown as the step instruction in the panel
}
```

**Key behaviors:**
- `content` is an ordered array so Claude can append items (e.g., a form below existing cards) or replace the entire content by clearing first.
- `activeWorkflow` being non-null changes the panel's visual mode to show step progress. When it becomes `null`, the panel returns to normal mode.
- `isVisible` lets Claude show/hide the panel as part of a workflow step — for example, hiding it when the user needs to draw on the map without obstruction.

---

### SessionState

Metadata and diagnostics.

```typescript
interface SessionState {
  sessionId: string;
  startedAt: number;             // Unix timestamp
  messageCount: number;          // Total messages sent this session
  toolExecutionLog: ToolLog[];   // Recent tool calls for debugging
  tokenUsage: TokenUsage | null; // Reported back from server (for usage monitoring)
}

interface ToolLog {
  toolName: string;
  calledAt: number;
  success: boolean;
  durationMs: number;
  error?: string;
}
```

---

## Full Store Definition

```typescript
import { create } from "zustand";

type UIFlowStore =
  ConversationState & ConversationActions &
  MapState         & MapActions &
  PanelState       & PanelActions &
  SessionState     & SessionActions;

export const useUIFlowStore = create<UIFlowStore>((set, get) => ({
  // --- Conversation ---
  messages: [],
  streamingMessage: "",
  isLoading: false,
  error: null,
  sessionId: crypto.randomUUID(),

  addMessage: (message) =>
    set((s) => ({ messages: [...s.messages, message] })),

  appendStreamingText: (delta) =>
    set((s) => ({ streamingMessage: s.streamingMessage + delta })),

  commitStreamingMessage: () =>
    set((s) => {
      if (!s.streamingMessage) return s;
      const committed: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: s.streamingMessage,
        timestamp: Date.now()
      };
      return { messages: [...s.messages, committed], streamingMessage: "" };
    }),

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  // --- Map ---
  viewport: { center: [-98.5795, 39.8283], zoom: 4 },
  markers: {},
  activeLayers: [],
  sources: {},
  drawingState: null,
  selectedMarkerId: null,

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
      ids.forEach((id) => delete updated[id]);
      return { markers: updated };
    }),

  clearMarkers: () => set({ markers: {} }),

  setSelectedMarker: (id) => set({ selectedMarkerId: id }),

  setDrawingState: (state) => set({ drawingState: state }),

  // --- Panel ---
  content: [],
  isVisible: false,
  activeWorkflow: null,

  setContent: (content) => set({ content, isVisible: true }),
  appendContent: (item) => set((s) => ({ content: [...s.content, item] })),
  clearContent: () => set({ content: [] }),
  setPanelVisible: (visible) => set({ isVisible: visible }),
  setActiveWorkflow: (step) => set({ activeWorkflow: step }),

  // --- Session ---
  startedAt: Date.now(),
  messageCount: 0,
  toolExecutionLog: [],
  tokenUsage: null,

  logToolExecution: (log) =>
    set((s) => ({
      toolExecutionLog: [...s.toolExecutionLog.slice(-49), log] // keep last 50
    })),
}));
```

---

## Applying Surface Updates

The `applySurfaceUpdate` function is the primary way AI-driven changes flow into the store. It is called by `ConversationManager` for each `SurfaceUpdate` in the AI response.

```typescript
applySurfaceUpdate: (update: SurfaceUpdate) =>
  set((state) => {
    if (update.surface === "map") {
      switch (update.op) {
        case "SET_VIEWPORT":
          return { viewport: update.payload as Viewport };
        case "ADD_MARKERS": {
          const next = { ...state.markers };
          (update.payload.markers as Marker[]).forEach((m) => (next[m.id] = m));
          return { markers: next };
        }
        case "REMOVE_MARKERS": {
          const next = { ...state.markers };
          (update.payload.ids as string[]).forEach((id) => delete next[id]);
          return { markers: next };
        }
        case "FIT_BOUNDS":
          // FIT_BOUNDS is handled imperatively by MapController via a ref
          // We still store the event for snapshot purposes
          return { lastFitBounds: update.payload };
      }
    }

    if (update.surface === "panel") {
      switch (update.op) {
        case "RENDER_CARDS":
          return { content: [{ type: "cards", items: update.payload.cards }], isVisible: true };
        case "RENDER_FORM":
          return { content: [{ type: "form", schema: update.payload.schema, values: {} }], isVisible: true };
        case "CLEAR":
          return { content: [] };
      }
    }

    return state;
  })
```

---

## Component Subscription Patterns

Components should subscribe to the smallest possible slice to avoid unnecessary re-renders.

```typescript
// Good: only re-renders when markers change
const markers = useUIFlowStore((s) => s.markers);

// Good: only re-renders when loading state changes
const isLoading = useUIFlowStore((s) => s.isLoading);

// Bad: re-renders on any store change
const store = useUIFlowStore();

// Good: derived value with shallow equality
const markerCount = useUIFlowStore((s) => Object.keys(s.markers).length);
```

---

## Key Design Decisions

**Why a single flat store instead of multiple stores?**
A single store makes it trivial to read cross-slice state when needed (e.g., the surface snapshot needs both map and panel state). Multiple stores would require coordination between them and risk inconsistency. The selective subscription model (Zustand's default) means the performance argument for multiple stores does not apply here.

**Why is `FIT_BOUNDS` handled imperatively?**
Mapbox's `fitBounds` is an imperative animation command — it is not a declarative state value like `viewport`. There is no "bounds to fit" state that persists; it is a one-time command. The `MapController` component subscribes to a `fitBoundsCommand` atom and calls `mapRef.fitBounds()` when it changes. After the animation, the map's viewport settles and `SET_VIEWPORT` can be used to read the final state back.

**Why is session state in the same store?**
For diagnostic and observability purposes. The `toolExecutionLog` in session state lets a dev panel display recent tool calls without needing a separate debug store. Keeping it co-located means it is always available and always consistent with the rest of the state.

---

## Files

```
apps/web/src/store/index.ts          # Full store definition and all actions
apps/web/src/store/types.ts          # TypeScript interfaces for all state slices
apps/web/src/hooks/useConversation.ts # Convenience hook: conversation slice
apps/web/src/hooks/useMapState.ts     # Convenience hook: map slice
apps/web/src/hooks/usePanelState.ts   # Convenience hook: panel slice
```
