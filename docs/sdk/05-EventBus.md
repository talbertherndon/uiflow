# EventBus

## What It Is

The EventBus is a **lightweight pub/sub system that bridges UI events to the conversation layer**. It is how non-text interactions — map clicks, drawing completions, form submissions, marker hovers — become part of the AI's context without requiring the user to type anything.

Without the EventBus, the AI only knows what the user explicitly types. With it, the AI can see and react to everything the user does in the interface. This is what makes UIFlow feel like an "outcome-driven" system rather than a standard chatbot.

---

## The Problem It Solves

Consider this interaction:

> User: "show me coffee shops near downtown"
> *AI drops 8 markers on the map*
> *User clicks on a marker called "Blue Bottle Coffee"*
> *User expects the AI to respond to that click*

Without the EventBus, the AI has no idea the user clicked anything. The click happened in Mapbox's internal event system and never entered the conversation.

With the EventBus:
1. Mapbox fires a `click` event on the marker
2. `MapSurface` publishes `{ type: "marker.click", data: { marker: { id: "m3", label: "Blue Bottle Coffee", ... } } }`
3. The EventBus route for `"marker.click"` is registered to inject a conversation event
4. `ConversationManager` receives the injection and sends it to the AI with context
5. The AI responds: "Blue Bottle Coffee on Mission St — they open at 7am. Want directions?"

---

## Responsibilities

### 1. Event Publication
Any module can publish an event to the bus. Events are typed and namespaced by surface:
- `map.*` — map interactions (click, hover, draw, moveend)
- `panel.*` — panel interactions (card click, form submit, filter change)
- `workflow.*` — workflow transitions (step complete, cancelled)
- `system.*` — system events (session start, error, token limit approached)

### 2. Route Registration
Handlers are registered to event types. Multiple handlers can listen to the same event. Handlers receive the event and a reference to the `ConversationManager` so they can inject conversation events.

### 3. Conversation Injection
The most common handler pattern: receive a map event and inject it into the conversation. The EventBus handles the plumbing; the handler decides whether to inject and what context to include.

### 4. Filtering and Debouncing
Not every event should trigger an AI response. The bus supports:
- **Debouncing** — `map.moveend` fires constantly during panning; you want to wait until the pan settles (500ms debounce) before injecting
- **Conditions** — inject only if a workflow is active, or only if a specific layer is visible
- **Silent vs. conversational** — some events update state only (no AI injection); others trigger a full conversation turn

---

## Interface

```typescript
interface EventBus {
  // Publish an event
  publish<T>(event: UIFlowEvent<T>): void;

  // Register a handler for an event type
  on<T>(
    eventType: string,
    handler: EventHandler<T>,
    options?: HandlerOptions
  ): () => void; // Returns unsubscribe function

  // Register a handler that auto-injects into conversation
  onAndInject<T>(
    eventType: string,
    buildEvent: (event: UIFlowEvent<T>) => ConversationEvent | null,
    options?: HandlerOptions
  ): () => void;
}

interface UIFlowEvent<T = unknown> {
  type: string;                       // e.g. "marker.click"
  surface?: string;                   // e.g. "map"
  data: T;
  timestamp: number;
}

interface HandlerOptions {
  debounceMs?: number;
  condition?: (event: UIFlowEvent) => boolean;
}

type EventHandler<T> = (event: UIFlowEvent<T>, ctx: EventContext) => void | Promise<void>;

interface EventContext {
  conversation: ConversationManager;
  store: UIFlowStore;
}
```

---

## Built-in Events Published by SDK

### Map Events

| Event Type | Published When | Data |
|---|---|---|
| `map.marker.click` | User clicks a marker | `{ marker: Marker }` |
| `map.marker.hover` | User hovers over a marker | `{ marker: Marker }` |
| `map.draw.complete` | User finishes drawing a shape | `{ feature: GeoJSON.Feature }` |
| `map.draw.cancel` | User cancels drawing | `{}` |
| `map.moveend` | Map pan/zoom animation ends | `{ viewport: Viewport }` |
| `map.click` | User clicks empty map area | `{ coordinates: [lng, lat] }` |
| `map.load` | Map finishes loading | `{ map: MapRef }` |

### Panel Events

| Event Type | Published When | Data |
|---|---|---|
| `panel.card.click` | User clicks a result card | `{ card: CardDefinition }` |
| `panel.form.submit` | User submits a form | `{ values: Record<string, unknown> }` |
| `panel.filter.change` | User changes a filter value | `{ field: string; value: unknown }` |
| `panel.action.click` | User clicks an action button on a card | `{ action: string; cardData: unknown }` |

### Workflow Events

| Event Type | Published When | Data |
|---|---|---|
| `workflow.step.complete` | A workflow step is completed | `{ workflowId: string; stepId: string; data: unknown }` |
| `workflow.complete` | Entire workflow finishes | `{ workflowId: string; collectedData: unknown }` |
| `workflow.cancelled` | User or AI cancels workflow | `{ workflowId: string }` |

---

## Usage Examples

### Marker Click → AI Response

```typescript
// In SDK setup (or developer's app code)
sdk.onMapEvent("map.marker.click", (event, { conversation }) => {
  conversation.injectEvent({
    type: "map_interaction",
    description: `User selected "${event.data.marker.label}" on the map`,
    data: {
      markerId: event.data.marker.id,
      label: event.data.marker.label,
      coordinates: event.data.marker.coordinates,
      metadata: event.data.marker.metadata
    }
  });
});
```

### Draw Complete → AI Receives Polygon

```typescript
sdk.onMapEvent("map.draw.complete", (event, { conversation }) => {
  conversation.injectEvent({
    type: "map_area_drawn",
    description: "User drew an area on the map",
    data: {
      geojson: event.data.feature,
      area: turf.area(event.data.feature) // square meters
    }
  });
});
```

### Map Moveend → Silent State Update (No AI injection)

```typescript
// Just update the store — don't bother the AI with every pan
sdk.eventBus.on("map.moveend", (event, { store }) => {
  store.setViewport(event.data.viewport);
}, { debounceMs: 300 });
```

### Panel Card Click → Highlight Marker + AI Summary

```typescript
sdk.eventBus.on("panel.card.click", (event, { store, conversation }) => {
  const { card } = event.data;

  // Highlight the corresponding marker on the map
  if (card.markerId) {
    store.setSelectedMarker(card.markerId);
  }

  // Ask AI to elaborate on the selection
  conversation.injectEvent({
    type: "user_selected_result",
    description: `User selected "${card.title}" from the results panel`,
    data: card,
    silent: false // Show as a message in the chat
  });
});
```

### Filter Change → Re-query (No AI, just tool call)

```typescript
sdk.eventBus.on("panel.filter.change", async (event, { conversation }) => {
  // Inject a silent event — AI will call the search tool with new filters
  await conversation.injectEvent({
    type: "filter_updated",
    description: `User changed filter "${event.data.field}" to "${event.data.value}"`,
    data: event.data,
    silent: true // Don't show in chat UI — just trigger the AI action
  });
});
```

---

## Silent vs. Conversational Events

Events injected into the conversation can be either visible or invisible to the user in the chat UI.

| Mode | `silent: true` | `silent: false` |
|---|---|---|
| Shown in message list? | No | Yes, as a system message |
| AI receives it? | Yes | Yes |
| Use case | Filter changes, background sync | User clicks, draw actions, confirmations |

Silent events are useful for triggering AI actions without cluttering the conversation. For example, when a user changes a filter in the panel, you want Claude to re-run the search with the new criteria — but you don't want a message in the chat that says "User changed cuisine filter to Italian."

---

## Key Design Decisions

**Why pub/sub instead of direct callbacks?**
Pub/sub decouples the event source (MapSurface) from the event consumer (ConversationManager). MapSurface doesn't need to know anything about conversations — it just fires events. Multiple handlers can listen to the same event without the emitter knowing about any of them. This is especially important as new surfaces are added in Phase 3.

**Why not just use React's synthetic events or a Context callback?**
React's event system is scoped to components in a tree. The EventBus needs to work across the component tree boundary (map events should be receivable by the conversation layer, which is in a sibling component subtree). A standalone bus solves this cleanly without prop drilling or context tunneling.

**Why debouncing on `map.moveend`?**
Mapbox fires `moveend` once per pan/zoom interaction, not continuously. But if Claude reacted to every pan by querying for results in the new viewport, the system would make dozens of API calls per session just from casual map exploration. The 300ms debounce (or requiring the user to explicitly ask "what's here?") keeps the AI interaction intentional.

---

## Files

```
apps/web/src/lib/eventBus.ts          # EventBus class, pub/sub implementation
apps/web/src/surfaces/MapSurface.tsx  # Publishes map.* events
apps/web/src/surfaces/PanelSurface.tsx # Publishes panel.* events
apps/web/src/hooks/useMapEvents.ts    # Hook for registering map event handlers
```
