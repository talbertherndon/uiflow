# SurfaceRegistry

## What It Is

The SurfaceRegistry is the **routing layer between AI intent and UI execution**. When Claude decides to update the map or render a card in the panel, it expresses that as a `SurfaceUpdate` object. The SurfaceRegistry receives that object, looks up which surface controller handles it, and delivers the command.

It is a simple but critical abstraction: it is the seam that lets UIFlow support multiple UI surfaces (map, panel, chart, table, 3D viewer, etc.) without the `ConversationManager` or AI layer needing to know anything about how those surfaces work internally.

---

## Responsibilities

### 1. Registering Surface Controllers
Developers (and the SDK itself) register surface controllers by a string ID. The built-in surfaces are `"map"` and `"panel"`. A developer could register `"chart"` or `"timeline"` in Phase 3.

```typescript
registry.register("map", mapSurfaceController);
registry.register("panel", panelSurfaceController);
```

### 2. Dispatching Surface Updates
When a `SurfaceUpdate` arrives (from a stream event or a complete `AIResponse`), the registry:
1. Looks up the controller by `update.surface` (e.g., `"map"`)
2. Calls `controller.apply(update)`
3. The controller translates the typed command into actual UI behavior

### 3. Collecting Surface Snapshots
Before each AI request, the `ConversationManager` asks the registry to produce a compact snapshot of all active surfaces. The registry asks each registered controller for its current state and merges the results. This snapshot is sent to the server so Claude has context about what's currently visible.

### 4. Lifecycle Management
The registry manages controller lifecycle: initialization, teardown, and re-initialization when the session resets. If a surface controller throws during `apply()`, the registry catches the error, logs it, and does not crash the conversation.

---

## What It Does NOT Do

- It does not interpret `SurfaceUpdate` payloads — that is the controller's job
- It does not know about Claude or the AI layer
- It does not persist state — each controller owns its own state slice in the `StateStore`
- It does not decide which surface to update — Claude decides that by setting `update.surface`

---

## Interface

```typescript
interface SurfaceController {
  // Apply a typed command to this surface
  apply(update: SurfaceUpdate): void | Promise<void>;

  // Return a compact snapshot of current surface state for context
  snapshot(): SurfaceSnapshot;

  // Optional: called when the session resets (new conversation)
  reset?(): void;
}

interface SurfaceRegistry {
  register(surfaceId: string, controller: SurfaceController): void;
  unregister(surfaceId: string): void;
  dispatch(update: SurfaceUpdate): void;
  snapshot(): Record<string, SurfaceSnapshot>;
}
```

---

## Built-in Surface Controllers

### MapSurface Controller
Handles all `surface: "map"` updates. Wraps Mapbox GL JS via react-map-gl.

| Op | What It Does |
|---|---|
| `SET_VIEWPORT` | `mapRef.flyTo({ center, zoom, duration: 1200 })` |
| `ADD_MARKERS` | Adds marker objects to `StateStore`, React re-renders them |
| `REMOVE_MARKERS` | Removes by ID from `StateStore` |
| `FIT_BOUNDS` | `mapRef.fitBounds(bounds, { padding })` |
| `SET_LAYER` | Toggles or reconfigures a Mapbox layer by ID |
| `ADD_SOURCE` | Adds a GeoJSON or tile source to the map |
| `DRAW_POLYGON` | Activates Mapbox Draw in polygon mode |
| `SET_STYLE` | `mapRef.setStyle(styleUrl)` |

### PanelSurface Controller
Handles all `surface: "panel"` updates. Renders dynamic React components from JSON schema.

| Op | What It Does |
|---|---|
| `RENDER_CARDS` | Renders a list of card components with AI-supplied props |
| `RENDER_FORM` | Renders a JSON Schema form via react-jsonschema-form |
| `RENDER_FILTERS` | Renders a filter bar with field definitions |
| `RENDER_TABLE` | Renders a data table with column definitions + row data |
| `APPEND_TEXT` | Streams markdown text into the panel |
| `CLEAR` | Resets panel content to empty |

---

## Registering a Custom Surface

```typescript
// A custom chart surface
const chartController: SurfaceController = {
  apply(update) {
    switch (update.op) {
      case "SET_DATA":
        store.setState({ chartData: update.payload.data });
        break;
      case "SET_TYPE":
        store.setState({ chartType: update.payload.type });
        break;
    }
  },
  snapshot() {
    const { chartType, chartData } = store.getState();
    return { chartType, dataPointCount: chartData?.length ?? 0 };
  }
};

sdk.surfaces.register("chart", chartController);
```

Now Claude can call:
```json
{ "surface": "chart", "op": "SET_DATA", "payload": { "data": [...] } }
```

---

## Surface Snapshot Format

The snapshot is a compact JSON object included in every Claude prompt. It tells Claude what is currently visible so it can make contextually correct decisions.

```typescript
// Full snapshot sent with each request
{
  "map": {
    "viewport": { "center": [-122.4, 37.7], "zoom": 13 },
    "markerCount": 5,
    "visibleMarkers": [
      { "id": "m1", "label": "Blue Bottle Coffee", "coordinates": [-122.401, 37.702] },
      ...
    ],
    "activeLayers": ["zoning-overlay"],
    "drawingActive": false
  },
  "panel": {
    "contentType": "cards",
    "itemCount": 5,
    "activeWorkflowStep": null
  }
}
```

---

## Data Flow

```
AIResponse arrives with surfaceUpdates: [
  { surface: "map",   op: "SET_VIEWPORT", payload: { ... } },
  { surface: "map",   op: "ADD_MARKERS",  payload: { ... } },
  { surface: "panel", op: "RENDER_CARDS", payload: { ... } }
]
    │
    ▼
ConversationManager calls: registry.dispatch(update) for each
    │
    ▼
SurfaceRegistry lookup:
  "map"   → MapSurfaceController.apply(update)   → Mapbox GL JS
  "panel" → PanelSurfaceController.apply(update) → React re-render
    │
    ▼
StateStore updated → UI reflects new state
```

---

## Key Design Decisions

**Why a string-keyed registry instead of hardcoded surface types?**
It makes the system extensible without modifying core SDK code. A developer can register a `"timeline"` or `"3d-viewer"` surface and Claude can control it using the same `SurfaceUpdate` pattern — as long as the developer registers the right tool schemas on the server side so Claude knows how to produce those updates.

**Why does the controller own the apply logic, not the registry?**
Single responsibility. The registry only routes. The controller only applies. This means a developer can swap out the map library (e.g., replace Mapbox with MapLibre) by writing a new controller that implements the same `SurfaceController` interface — the rest of the system is unaffected.

**Why are surface updates dispatched in order, not in parallel?**
Surface updates within a single AI response are often intentionally sequential — set the viewport first, then add markers so they land in the right place. Parallel dispatch could cause a race where markers are added before the viewport moves. Ordered dispatch is safer and the performance difference is negligible for 2-5 updates.

---

## Files

```
apps/web/src/surfaces/SurfaceRegistry.ts   # Registry class + dispatch logic
apps/web/src/surfaces/MapSurface.tsx        # Map controller + React component
apps/web/src/surfaces/PanelSurface.tsx      # Panel controller + dynamic renderer
```
