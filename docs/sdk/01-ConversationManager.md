# ConversationManager

## What It Is

The ConversationManager is the **single entry point for all user interaction**. Every message the user sends, every AI response that comes back, and every streaming update flows through here. Nothing reaches the AI or the surfaces without passing through this module first.

Think of it as the traffic controller: it owns the send/receive lifecycle, maintains message ordering, handles streaming state, and coordinates the delivery of AI responses back to the store and surfaces.

---

## Responsibilities

### 1. Sending Messages
When the user submits a message, the ConversationManager:
- Optimistically adds the user message to the `StateStore` immediately (so the UI updates before the server responds)
- Attaches the current surface snapshot (map viewport, active markers, panel state) to the request payload
- Sends the request to the server via `POST /api/chat/message`
- Sets `isLoading: true` in the store

### 2. Managing the SSE Stream
Responses come back as Server-Sent Events so text can stream in real time. The ConversationManager:
- Opens and manages the SSE connection per message
- Handles streaming text deltas (appends to a `streamingMessage` buffer in the store)
- Handles `surfaceUpdate` events mid-stream (dispatches to `SurfaceRegistry` immediately, before the text finishes)
- Closes the stream cleanly on completion or error

### 3. Dispatching Surface Updates
When the AI response arrives (or streams in), it contains `surfaceUpdates[]`. The ConversationManager passes each update to the `SurfaceRegistry`, which routes it to the right surface controller. ConversationManager does not know what a `SET_VIEWPORT` means — it just delivers the package.

### 4. Finalizing the Message
Once the stream completes:
- The `streamingMessage` buffer is committed as a full `Message` to the store
- `isLoading` is set back to false
- Any workflow events in the response are forwarded to the `WorkflowEngine`

### 5. Error Handling
- Network errors: surfaces a human-readable error message in the chat
- API errors (4xx/5xx): displays the error without crashing the conversation
- Stream interruptions: marks the partial message as incomplete, offers a retry

### 6. Injecting Map Events
The `EventBus` can trigger the ConversationManager to send an AI-visible event without the user typing anything. For example, when the user clicks a map marker, the EventBus fires and ConversationManager injects a synthetic message like `"[map:marker_click] User clicked: Blue Bottle Coffee"` — the AI sees this and can respond contextually.

---

## What It Does NOT Do

- It does not parse or interpret AI responses — that is the `ResponseComposer`'s job (server-side)
- It does not directly update the map or panel — it delegates to `SurfaceRegistry`
- It does not manage conversation history — that lives in `StateStore`
- It does not know about workflows — it forwards workflow events to `WorkflowEngine`

---

## Interface

```typescript
interface ConversationManager {
  // Send a user message. Returns when the full response is received.
  send(message: string, options?: SendOptions): Promise<void>;

  // Inject a non-user event into the conversation (e.g., from a map click)
  injectEvent(event: ConversationEvent): Promise<void>;

  // Retry the last failed message
  retry(): Promise<void>;

  // Cancel an in-progress stream
  cancel(): void;

  // Subscribe to streaming text deltas (for custom rendering)
  onStreamDelta(callback: (delta: string) => void): () => void;
}

interface SendOptions {
  sessionId?: string;
  surfaceSnapshot?: SurfaceSnapshot; // auto-built from StateStore if omitted
}

interface ConversationEvent {
  type: string;              // e.g. "map_marker_click", "map_draw_complete"
  description: string;       // human-readable, sent to Claude as context
  data?: Record<string, unknown>;
  silent?: boolean;          // if true, not shown in the chat UI
}
```

---

## State It Owns (via StateStore)

```typescript
interface ConversationState {
  messages: Message[];          // full history, displayed in MessageList
  streamingMessage: string;     // partial text during active stream
  isLoading: boolean;           // true while waiting for AI response
  error: string | null;         // last error, cleared on next send
  sessionId: string;
}
```

---

## Data Flow

```
User submits "find coffee shops near me"
    │
    ▼
ConversationManager.send()
    ├── Store: addMessage({ role: "user", content: "..." })
    ├── Store: setLoading(true)
    ├── Build payload: { sessionId, message, surfaceSnapshot }
    │
    ▼
POST /api/chat/message
    │
    ▼
SSE stream opens
    ├── event: text_delta       → Store: appendStreamingText(delta)
    ├── event: surface_update   → SurfaceRegistry.dispatch(update)
    ├── event: workflow_event   → WorkflowEngine.handle(event)
    └── event: stream_end
            │
            ▼
    Store: commitStreamingMessage()   // moves buffer → messages[]
    Store: setLoading(false)
```

---

## Key Design Decisions

**Why SSE and not WebSockets?**
SSE is unidirectional (server → client) which is exactly what's needed here. The client sends messages via regular HTTP POST. SSE is simpler to implement, easier to debug, and works through HTTP/2 without special server configuration. WebSockets would be needed if the server needed to push unsolicited events — which may become relevant in Phase 3 (e.g., background data updates).

**Why optimistic user messages?**
Adding the user message to the store immediately (before the server responds) makes the UI feel instant. If the request fails, the message is marked with an error state and a retry button. This is the expected behavior in every modern chat interface.

**Why does ConversationManager build the surface snapshot?**
The AI needs to know what is currently on the map and panel to give contextually correct responses. By attaching the surface snapshot to every request, the server-side `ContextBuilder` always has up-to-date context without needing to maintain a perfect server-side mirror of client state. This also makes the system self-healing — if the server's session state drifts, the next message re-syncs it automatically.

---

## Files

```
apps/web/src/lib/conversation.ts     # Core send/stream/inject logic
apps/web/src/hooks/useConversation.ts # React hook wrapping ConversationManager
```
