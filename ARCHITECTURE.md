# UIFlow: Outcome-Driven UI SDK — Architecture & Implementation Plan

---

## Core Concept

The fundamental principle: **the conversation layer is the source of truth**. The map, panel, and actions are all downstream outputs of Claude's interpretation of user intent. Claude communicates intent exclusively through structured tool calls — never parsed free-text.

---

## Architecture Overview

```
User Message
    │
    ▼
ConversationManager (client)
    │  POST /api/chat/message
    ▼
ContextBuilder (server)
  - message history (last 20)
  - surface snapshot (current viewport, markers)
  - registered tool schemas
    │
    ▼
Claude API (tool_use enabled)
  → calls map_set_viewport + map_add_markers + panel_render_cards
    │
    ▼
ToolExecutor → ResponseComposer
  → AIResponse { content, surfaceUpdates[] }
    │  SSE stream
    ▼
SurfaceRegistry (client)
  → MapSurface.apply(update)   → Mapbox GL JS calls
  → PanelSurface.apply(update) → React renders dynamic components
    │
    ▼
Zustand StateStore updated → UI re-renders
```

### Full System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          BROWSER / CLIENT                               │
│                                                                         │
│  ┌──────────────┐    ┌─────────────────────────────────────────────┐   │
│  │   Chat UI    │    │              Surface Renderer               │   │
│  │              │    │                                             │   │
│  │ MessageList  │    │  ┌─────────────────┐  ┌─────────────────┐  │   │
│  │ InputBar     │    │  │   Map Surface   │  │  Panel Surface  │  │   │
│  │ TypingState  │    │  │                 │  │                 │  │   │
│  └──────┬───────┘    │  │  Mapbox GL JS   │  │  Dynamic Card   │  │   │
│         │            │  │  MapController  │  │  Form Renderer  │  │   │
│         │            │  │  LayerManager   │  │  Filter Panel   │  │   │
│         │            │  │  MarkerManager  │  │  Action Buttons │  │   │
│         │            │  └─────────────────┘  └─────────────────┘  │   │
│         │            └─────────────────────────────────────────────┘   │
│         │                           ▲                                   │
│         │                           │                                   │
│         ▼                           │                                   │
│  ┌──────────────────────────────────┴──────────────────────────────┐   │
│  │                    UIFlow Client SDK                            │   │
│  │                                                                 │   │
│  │   ConversationManager     SurfaceRegistry     ToolRegistry      │   │
│  │   StateStore (Zustand)    EventBus             WorkflowEngine   │   │
│  └────────────────────────────┬────────────────────────────────────┘   │
│                               │  HTTP / SSE                            │
└───────────────────────────────┼────────────────────────────────────────┘
                                │
┌───────────────────────────────┼────────────────────────────────────────┐
│                          NODE.JS SERVER                                │
│                               │                                        │
│  ┌────────────────────────────▼────────────────────────────────────┐  │
│  │                    Orchestration API                            │  │
│  │                                                                 │  │
│  │  POST /api/chat/message                                         │  │
│  │  GET  /api/chat/stream  (SSE)                                   │  │
│  │  GET  /api/session/:id                                          │  │
│  └────────────────────────────┬────────────────────────────────────┘  │
│                               │                                        │
│  ┌────────────────────────────▼────────────────────────────────────┐  │
│  │                    AI Orchestration Core                        │  │
│  │                                                                 │  │
│  │  IntentClassifier      ToolExecutor        ResponseComposer     │  │
│  │  ContextBuilder        WorkflowRunner      SchemaValidator      │  │
│  └────────────────────────────┬────────────────────────────────────┘  │
│                               │                                        │
│         ┌─────────────────────┼────────────────────┐                  │
│         ▼                     ▼                    ▼                  │
│  ┌─────────────┐    ┌─────────────────┐   ┌──────────────────┐       │
│  │  Anthropic  │    │  Tool Registry  │   │  Session Store   │       │
│  │  Claude API │    │  (registered    │   │  (Redis / mem)   │       │
│  │  (tool use) │    │   functions)    │   │                  │       │
│  └─────────────┘    └─────────────────┘   └──────────────────┘       │
└────────────────────────────────────────────────────────────────────────┘
```

### Data Flow for a Single Message

```
User types "show me coffee shops near downtown Austin"
        │
        ▼
ConversationManager.send(message)
        │
        ▼
POST /api/chat/message  { sessionId, message, surfaceState }
        │
        ▼
ContextBuilder assembles:
  - message history (last N turns)
  - current map viewport / active layers
  - registered tool schemas
  - active workflow state (if any)
        │
        ▼
Claude API called with tool_use enabled
  → Claude decides: call map_set_viewport + search_places + panel_show_cards
        │
        ▼
ToolExecutor runs each tool in dependency order
        │
        ▼
ResponseComposer assembles AIResponse {
  message: "Here are 8 coffee shops near downtown Austin",
  surfaceUpdates: [
    { surface: "map", op: "SET_VIEWPORT", payload: { ... } },
    { surface: "map", op: "ADD_MARKERS", payload: { ... } },
    { surface: "panel", op: "RENDER_CARDS", payload: { ... } }
  ]
}
        │
        ▼
SSE stream → client receives AIResponse
        │
        ▼
SurfaceRegistry dispatches each surfaceUpdate to the correct Surface
  MapSurface.apply(update)   → Mapbox GL JS calls
  PanelSurface.apply(update) → React renders dynamic components
        │
        ▼
StateStore updated → UI re-renders
```

---

## Key Modules

### Server-Side

| Module | Responsibility |
|---|---|
| `ContextBuilder` | Assembles Claude prompt: history + surface snapshot + tool schemas |
| `ToolExecutor` | Validates + runs tool calls, parallel batching, self-correction on error |
| `ResponseComposer` | Translates tool results → typed `SurfaceUpdate[]` |
| `WorkflowRunner` | Server-side multi-step workflow state machine |
| `SessionStore` | Per-session: history, surface snapshot, workflow state |

### Client-Side

| Module | Responsibility |
|---|---|
| `ConversationManager` | Sends messages, handles SSE stream, manages loading state |
| `StateStore` (Zustand) | Single source of truth for conversation + map + panel + workflow |
| `SurfaceRegistry` | Routes `SurfaceUpdate` commands to the correct controller |
| `MapSurface` | Wraps Mapbox GL JS, applies typed commands |
| `PanelSurface` | JSON-schema → React component renderer |
| `WorkflowEngine` | Tracks active step, collects data, injects step context |
| `EventBus` | Map click/draw events → auto-inject into conversation |

---

## Shared Types (`packages/types/src/index.ts`)

```typescript
export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  surfaceUpdates?: SurfaceUpdate[];
  toolResults?: ToolResult[];
}

export type SurfaceUpdateOp =
  | "SET_VIEWPORT"
  | "ADD_MARKERS"
  | "REMOVE_MARKERS"
  | "FIT_BOUNDS"
  | "RENDER_CARDS"
  | "RENDER_FORM"
  | "CLEAR_PANEL";

export interface SurfaceUpdate {
  surface: "map" | "panel" | string;
  op: SurfaceUpdateOp;
  payload: Record<string, unknown>;
}

export interface AIResponse {
  messageId: string;
  content: string;
  surfaceUpdates: SurfaceUpdate[];
  workflowEvent?: WorkflowEvent;
}

export interface Marker {
  id: string;
  coordinates: [number, number]; // [lng, lat]
  label: string;
  color?: string;
  metadata?: Record<string, unknown>;
}

export interface Viewport {
  center: [number, number];
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface WorkflowEvent {
  type: "STARTED" | "STEP_ADVANCED" | "COMPLETED" | "CANCELLED";
  workflowId: string;
  stepId?: string;
}
```

---

## SDK Developer Interface

### Registering Tools

```typescript
import { UIFlowSDK } from "@uiflow/sdk";

const sdk = new UIFlowSDK({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  mapboxToken: process.env.MAPBOX_TOKEN,
  sessionStore: "memory", // or "redis"
});

sdk.registerTool({
  name: "search_businesses",
  description: "Search for businesses by type and location. Use when the user asks to find places, shops, restaurants, or services.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      location: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lng: { type: "number" },
          radiusMeters: { type: "number" }
        },
        required: ["lat", "lng"]
      },
      limit: { type: "number", default: 10 }
    },
    required: ["query", "location"]
  },
  execute: async ({ query, location, limit }) => {
    const results = await placesAPI.search(query, location, limit);
    return { businesses: results, count: results.length };
  }
});
```

### Registering Workflows

```typescript
sdk.registerWorkflow("add_location_pin", {
  description: "Walk user through adding a custom annotated pin to the map",
  steps: [
    { id: "pick_location", prompt: "Click on the map where you want to place the pin" },
    { id: "add_label",     prompt: "What would you like to label this pin?" },
    { id: "choose_category", prompt: "What category is this? (e.g., restaurant, landmark, office)" },
    { id: "confirm",       prompt: "Confirm pin placement" }
  ],
  onComplete: async (data, sdk) => {
    await sdk.tools.execute("save_custom_pin", data);
  }
});
```

### Registering Custom UI Components

```typescript
sdk.registerComponent("PropertyListingCard", {
  component: PropertyListingCard,
  propsSchema: {
    type: "object",
    properties: {
      address: { type: "string" },
      price: { type: "number" },
      bedrooms: { type: "number" },
      imageUrl: { type: "string" },
      listingId: { type: "string" }
    }
  }
});
```

### Hooking into Map Events

```typescript
sdk.onMapEvent("marker.click", async (event, conversation) => {
  await conversation.injectEvent({
    type: "map_interaction",
    description: `User clicked marker: ${event.marker.label}`,
    data: event.marker.metadata
  });
});

sdk.onMapEvent("draw.complete", async (event, conversation) => {
  await conversation.injectEvent({
    type: "map_draw_complete",
    description: "User drew a polygon on the map",
    data: { geojson: event.feature }
  });
});
```

### Mounting in React

```tsx
import { UIFlowProvider, MapSurface, PanelSurface, ChatInterface } from "@uiflow/react";

function App() {
  return (
    <UIFlowProvider sdk={sdk} sessionId="user-session-123">
      <div className="app-layout">
        <MapSurface
          initialViewport={{ center: [-97.74, 30.26], zoom: 12 }}
          style="mapbox://styles/mapbox/streets-v12"
        />
        <PanelSurface position="right" width={380} />
        <ChatInterface position="bottom" />
      </div>
    </UIFlowProvider>
  );
}
```

---

## Tech Stack

### Frontend

| Concern | Choice | Rationale |
|---|---|---|
| Framework | React 18 + TypeScript | Component model maps cleanly to surface abstraction |
| Build tool | Vite | Fast dev loop, simple config |
| State management | Zustand | Lightweight, TypeScript-first, no boilerplate |
| Map | Mapbox GL JS + react-map-gl | Most capable JS map library, strong TypeScript types |
| Dynamic forms | react-jsonschema-form (RJSF) | JSON Schema → form, matches how Claude outputs UI specs |
| Styling | Tailwind CSS + shadcn/ui | Utility-first, composable |
| SSE client | Native EventSource + @microsoft/fetch-event-source | Resilient SSE with retry |
| Markdown | react-markdown | Panel text content rendering |

### Backend

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 20+ | Ecosystem, TypeScript native |
| Framework | Fastify | Performance, schema validation built-in, TypeScript-first |
| AI | Anthropic SDK (@anthropic-ai/sdk) | Native tool use, streaming |
| Session storage | In-memory Map (MVP) → Redis | Start simple, Redis for multi-instance |
| Validation | Zod | TypeScript-native schema validation for tool params |

### What to Avoid for MVP

- **No LangChain/LlamaIndex** — Claude's native tool use is sufficient and more predictable
- **No vector database** — rolling window context + surface snapshots is enough
- **No WebSockets** — SSE is simpler; HTTP handles sends
- **No message queue** — direct async tool execution is fine until you hit slow external APIs

---

## Folder Structure

```
uiflow/
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
│
├── packages/
│   ├── types/                      # Shared TypeScript types
│   │   └── src/
│   │       ├── index.ts
│   │       ├── messages.ts
│   │       ├── surfaces.ts
│   │       ├── tools.ts
│   │       └── workflows.ts
│   │
│   └── sdk/                        # Phase 3: publishable SDK core
│       └── src/
│           ├── UIFlowSDK.ts
│           ├── ToolRegistry.ts
│           ├── SurfaceRegistry.ts
│           ├── WorkflowEngine.ts
│           └── MemoryManager.ts
│
├── apps/
│   ├── api/                        # Node.js / Fastify backend
│   │   └── src/
│   │       ├── index.ts
│   │       ├── config.ts
│   │       ├── handlers/
│   │       │   ├── chat.ts         # POST /api/chat/message — START HERE
│   │       │   └── session.ts
│   │       ├── orchestration/
│   │       │   ├── ContextBuilder.ts
│   │       │   ├── ToolExecutor.ts
│   │       │   ├── ResponseComposer.ts
│   │       │   └── WorkflowRunner.ts
│   │       ├── tools/
│   │       │   ├── registry.ts
│   │       │   ├── map.tools.ts
│   │       │   └── example/search.ts
│   │       └── session/store.ts
│   │
│   └── web/                        # React frontend
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── store/index.ts       # Zustand store — single source of truth
│           ├── lib/
│           │   ├── conversation.ts  # sendMessage, SSE handling
│           │   └── api.ts
│           ├── surfaces/
│           │   ├── MapSurface.tsx   # Mapbox GL JS wrapper
│           │   └── PanelSurface.tsx
│           ├── components/
│           │   ├── chat/
│           │   │   ├── ChatInterface.tsx
│           │   │   ├── MessageList.tsx
│           │   │   ├── MessageItem.tsx
│           │   │   └── ChatInput.tsx
│           │   └── panel/
│           │       ├── CardRenderer.tsx
│           │       ├── FormRenderer.tsx
│           │       └── FilterPanel.tsx
│           └── hooks/
│               ├── useConversation.ts
│               ├── useMapEvents.ts
│               └── useWorkflow.ts
```

---

## Phased Roadmap

### Phase 1 — Map + Chat + Markers (Week 1-2)

**Goal:** A working chat interface where Claude can pan the map, add/remove markers, and respond in text.

**Deliverables:**
- Monorepo setup: `apps/web`, `apps/api`, `packages/types`
- Fastify server with `/api/chat/message` + SSE stream
- In-memory session store
- 4 built-in map tools: `map_set_viewport`, `map_add_markers`, `map_remove_markers`, `map_fit_bounds`
- `ContextBuilder` with rolling 20-message history + viewport in context
- `ResponseComposer` translating tool results → `SurfaceUpdate[]`
- Mapbox GL JS map with react-map-gl
- Zustand store with `ConversationState` + `MapState` slices
- SSE streaming chat UI
- `MapSurface` applying `SET_VIEWPORT` and `ADD_MARKERS`

**Milestone:** User types "show me the Eiffel Tower" → map flies to Paris, marker drops.

### Phase 2 — Structured UI + Workflows (Week 3-4)

**Goal:** Claude generates side-panel UI; forms, filter panels, and multi-step workflows work.

**Deliverables:**
- `PanelSurface` with `panel_render_cards`, `panel_render_form`, `panel_render_filters`
- RJSF integration for form rendering
- Component registry for custom card types
- Panel ↔ map interaction (clicking a card highlights a marker)
- Full `ToolExecutor` with parallel batching + error recovery
- `search_businesses` example tool with mock Places API
- Tool confirmation flow for destructive operations
- `WorkflowEngine` (client) + `WorkflowRunner` (server)
- One complete workflow: "Save a location" (click → label → category → confirm)
- `map_draw_polygon` drawing mode
- `map_set_layer` for toggling overlay layers
- Map click → inject event into conversation

**Milestone:** "Find coffee shops near me" → markers + panel cards → user saves a favorite.

### Phase 3 — Generalized SDK (Week 5-6)

**Goal:** Extract into a publishable SDK. Developer experience and production hardening.

**Deliverables:**
- `packages/sdk` — core orchestration package
- `packages/react` — React components and hooks
- Clean `UIFlowSDK` class with full developer API
- Plugin architecture for custom surfaces
- `MemoryManager`: conversation summarization + fact extraction per session
- Redis session store
- Rate limiting on orchestration API
- Token budget management (intelligent history truncation)
- TypeScript types + JSDoc on all public APIs
- README with 5-minute quickstart

**Milestone:** Developer installs `@uiflow/sdk` and ships a working app in under 30 minutes.

---

## Minimal Working Example

### End-to-End Flow Trace

```
1. User types: "Show me coffee shops near the Space Needle in Seattle"

2. sendMessage() called:
   - Adds user message to store (UI shows immediately)
   - POST /api/chat/message { sessionId, message }

3. Server: handleChatMessage()
   - Hydrates session (messages, current viewport)
   - Builds system prompt with surface snapshot
   - Calls Claude with MAP_TOOLS available

4. Claude decides to call:
   - map_set_viewport({ center: [-122.3493, 47.6205], zoom: 15 })
   - map_add_markers({ markers: [
       { id: "cf1", coordinates: [-122.351, 47.621], label: "Starbucks Reserve" },
       { id: "cf2", coordinates: [-122.348, 47.619], label: "Lighthouse Coffee" },
       { id: "cf3", coordinates: [-122.352, 47.618], label: "Caffe Ladro" }
     ]})
   - map_fit_bounds({ padding: 60 })
   Claude text: "Found 3 coffee shops within walking distance of the Space Needle."

5. processToolCall() runs for each → builds SurfaceUpdate[]

6. Server returns AIResponse {
     content: "Found 3 coffee shops...",
     surfaceUpdates: [
       { surface: "map", op: "SET_VIEWPORT", payload: { center: [-122.3493, 47.6205], zoom: 15 } },
       { surface: "map", op: "ADD_MARKERS", payload: { markers: [...] } },
       { surface: "map", op: "FIT_BOUNDS",  payload: { padding: 60 } }
     ]
   }

7. Client: applySurfaceUpdate() called for each
   - Zustand store updated: viewport changed, markers added

8. MapController useEffect fires → mapRef.flyTo(Seattle)
   Mapbox markers re-render from store

9. AI message added to conversation list

10. User sees: map flew to Seattle, 3 markers dropped, chat shows confirmation
```

### Key Server Handler (`apps/api/src/handlers/chat.ts`)

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { AIResponse, SurfaceUpdate, Viewport, Marker } from "@uiflow/types";

const client = new Anthropic();

const MAP_TOOLS: Anthropic.Tool[] = [
  {
    name: "map_set_viewport",
    description: "Pan and zoom the map to a specific location. Use when the user mentions a place, address, city, or region.",
    input_schema: {
      type: "object",
      properties: {
        center: { type: "array", items: { type: "number" }, description: "Longitude, latitude [lng, lat]" },
        zoom:   { type: "number", description: "Zoom level 0-22. Cities: 10-12. Streets: 14-16." },
        label:  { type: "string", description: "Human-readable location name" }
      },
      required: ["center", "zoom"]
    }
  },
  {
    name: "map_add_markers",
    description: "Add one or more markers to the map. Use when displaying search results or points of interest.",
    input_schema: {
      type: "object",
      properties: {
        markers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id:          { type: "string" },
              coordinates: { type: "array", items: { type: "number" } },
              label:       { type: "string" },
              color:       { type: "string" },
              metadata:    { type: "object" }
            },
            required: ["id", "coordinates", "label"]
          }
        }
      },
      required: ["markers"]
    }
  },
  {
    name: "map_fit_bounds",
    description: "Fit the map viewport to contain all current markers.",
    input_schema: {
      type: "object",
      properties: {
        padding: { type: "number", default: 50 }
      }
    }
  }
];

function buildSystemPrompt(surfaceSnapshot: string): string {
  return `You are UIFlow, an AI assistant that controls a map interface and side panel.

CAPABILITIES:
- Pan/zoom the map using map_set_viewport
- Add markers using map_add_markers
- Fit map to markers using map_fit_bounds

RULES:
- When a user mentions a location: ALWAYS call map_set_viewport
- When returning search results with locations: ALWAYS call map_add_markers AND map_fit_bounds
- Be concise. The map does the showing — your text confirms and explains.
- Never invent coordinates. Use the geocode tool if you need to resolve a place name.

CURRENT MAP STATE:
${surfaceSnapshot}`;
}

interface ChatSession {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  viewport: Viewport;
  markers: Record<string, Marker>;
}

const sessions = new Map<string, ChatSession>();

function getSession(sessionId: string): ChatSession {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      messages: [],
      viewport: { center: [-98.5795, 39.8283], zoom: 4 },
      markers: {}
    });
  }
  return sessions.get(sessionId)!;
}

export async function handleChatMessage(
  sessionId: string,
  userMessage: string,
  reply: (data: AIResponse) => void
) {
  const session = getSession(sessionId);
  session.messages.push({ role: "user", content: userMessage });

  const surfaceSnapshot = JSON.stringify({
    viewport: session.viewport,
    markerCount: Object.keys(session.markers).length,
    visibleMarkers: Object.values(session.markers).slice(0, 5)
      .map((m) => ({ id: m.id, label: m.label, coordinates: m.coordinates }))
  }, null, 2);

  const response = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    system: buildSystemPrompt(surfaceSnapshot),
    tools: MAP_TOOLS,
    messages: session.messages.slice(-20)
  });

  const surfaceUpdates: SurfaceUpdate[] = [];
  let textContent = "";

  for (const block of response.content) {
    if (block.type === "text") {
      textContent = block.text;
    } else if (block.type === "tool_use") {
      const update = processToolCall(block.name, block.input as Record<string, unknown>, session);
      if (update) surfaceUpdates.push(update);
    }
  }

  session.messages.push({ role: "assistant", content: textContent || "Done." });

  reply({ messageId: crypto.randomUUID(), content: textContent, surfaceUpdates });
}

function processToolCall(
  toolName: string,
  input: Record<string, unknown>,
  session: ChatSession
): SurfaceUpdate | null {
  switch (toolName) {
    case "map_set_viewport": {
      const viewport = { center: input.center as [number, number], zoom: input.zoom as number };
      session.viewport = viewport;
      return { surface: "map", op: "SET_VIEWPORT", payload: viewport };
    }
    case "map_add_markers": {
      const markers = input.markers as Marker[];
      markers.forEach((m) => (session.markers[m.id] = m));
      return { surface: "map", op: "ADD_MARKERS", payload: { markers } };
    }
    case "map_fit_bounds":
      return { surface: "map", op: "FIT_BOUNDS", payload: { padding: (input.padding as number) ?? 50 } };
    default:
      return null;
  }
}
```

### Client State Store (`apps/web/src/store/index.ts`)

```typescript
import { create } from "zustand";
import type { Message, Marker, Viewport, SurfaceUpdate } from "@uiflow/types";

interface UIFlowStore {
  messages: Message[];
  isLoading: boolean;
  viewport: Viewport;
  markers: Record<string, Marker>;
  addMessage: (message: Message) => void;
  setLoading: (loading: boolean) => void;
  setViewport: (viewport: Viewport) => void;
  addMarkers: (markers: Marker[]) => void;
  removeMarkers: (ids: string[]) => void;
  applySurfaceUpdate: (update: SurfaceUpdate) => void;
}

export const useUIFlowStore = create<UIFlowStore>((set) => ({
  messages: [],
  isLoading: false,
  viewport: { center: [-98.5795, 39.8283], zoom: 4 },
  markers: {},

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  setLoading: (loading) => set({ isLoading: loading }),
  setViewport: (viewport) => set({ viewport }),

  addMarkers: (markers) =>
    set((state) => {
      const updated = { ...state.markers };
      markers.forEach((m) => (updated[m.id] = m));
      return { markers: updated };
    }),

  removeMarkers: (ids) =>
    set((state) => {
      const updated = { ...state.markers };
      ids.forEach((id) => delete updated[id]);
      return { markers: updated };
    }),

  applySurfaceUpdate: (update) =>
    set((state) => {
      if (update.surface !== "map") return state;
      switch (update.op) {
        case "SET_VIEWPORT":
          return { viewport: update.payload as Viewport };
        case "ADD_MARKERS": {
          const newMarkers = { ...state.markers };
          (update.payload.markers as Marker[]).forEach((m) => (newMarkers[m.id] = m));
          return { markers: newMarkers };
        }
        case "REMOVE_MARKERS": {
          const remaining = { ...state.markers };
          (update.payload.ids as string[]).forEach((id) => delete remaining[id]);
          return { markers: remaining };
        }
        default:
          return state;
      }
    })
}));
```

### Map Surface (`apps/web/src/surfaces/MapSurface.tsx`)

```tsx
import { useEffect } from "react";
import Map, { Marker as MapboxMarker, useMap } from "react-map-gl";
import { useUIFlowStore } from "../store";
import "mapbox-gl/dist/mapbox-gl.css";

function MapController() {
  const { current: mapRef } = useMap();
  const viewport = useUIFlowStore((s) => s.viewport);

  useEffect(() => {
    if (!mapRef) return;
    mapRef.flyTo({ center: viewport.center, zoom: viewport.zoom, duration: 1200 });
  }, [viewport, mapRef]);

  return null;
}

export function MapSurface() {
  const markers = useUIFlowStore((s) => s.markers);
  const viewport = useUIFlowStore((s) => s.viewport);

  return (
    <Map
      id="main-map"
      initialViewState={{ longitude: viewport.center[0], latitude: viewport.center[1], zoom: viewport.zoom }}
      style={{ width: "100%", height: "100%" }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
    >
      <MapController />
      {Object.values(markers).map((marker) => (
        <MapboxMarker
          key={marker.id}
          longitude={marker.coordinates[0]}
          latitude={marker.coordinates[1]}
          color={marker.color ?? "#3B82F6"}
        />
      ))}
    </Map>
  );
}
```

---

## Key Risks and Mitigations

| Risk | Mitigation |
|---|---|
| **Claude hallucinating coordinates** | Register a `geocode` tool (Mapbox Geocoding API). System prompt instructs: "never invent coordinates — always call geocode first." |
| **Tool call validation failures** | Zod validation before execution. On failure, inject error back to Claude for self-correction. |
| **Context window bloat** | Rolling 20-message window. Compressed surface snapshots (first 5 markers only). Phase 3: conversation summarization every 20 turns. |
| **Surface state divergence** | Client sends surface snapshot with every message. Server always trusts client snapshot over its own cache. |
| **Latency perception** | Show typing indicator immediately. SSE streaming so text appears as it generates. Apply surface updates mid-stream. |
| **Developer experience complexity** | Minimal public API: `registerTool`, `registerComponent`, `onMapEvent`. All internal complexity stays internal. |

### Key Tradeoffs

**Tool use vs. free-text parsing** — The system relies entirely on Claude's structured tool use. This is the right call: deterministic, validatable, version-stable. The tradeoff is that every new capability requires a new registered tool. This is a feature — it forces explicit API design.

**Server-side vs. client-side tool execution** — All tools run server-side: API keys stay secret, execution is auditable, private APIs are accessible. Browser-native operations (geolocation, file uploads) are special-cased as client-side tools whose results are sent back to the server.

---

## Where to Start

Build in this order — when these 4 files work end-to-end, the core loop is proven:

1. `packages/types/src/index.ts` — define `AIResponse`, `SurfaceUpdate`, `Viewport`, `Marker`
2. `apps/api/src/handlers/chat.ts` — Claude call + tool execution + response composition
3. `apps/web/src/store/index.ts` — Zustand store with map + conversation slices
4. `apps/web/src/surfaces/MapSurface.tsx` — apply `SET_VIEWPORT` + `ADD_MARKERS` commands
