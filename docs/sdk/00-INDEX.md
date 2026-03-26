# UIFlow SDK — Module Reference

Each module has a dedicated deep-dive document. Read them in order for a full mental model, or jump directly to the module you're working on.

---

## System Boundary

```
                    ┌─────────────────────────────────┐
                    │         BROWSER / CLIENT         │
                    │                                  │
                    │  01 ConversationManager          │
                    │  02 SurfaceRegistry              │
                    │     └─ MapSurface                │
                    │     └─ PanelSurface              │
                    │  03 ToolRegistry (client-side)   │
                    │  04 StateStore (Zustand)         │
                    │  05 EventBus                     │
                    │  06 WorkflowEngine (client half) │
                    └──────────────┬──────────────────┘
                                   │ HTTP / SSE
                    ┌──────────────▼──────────────────┐
                    │         NODE.JS SERVER           │
                    │                                  │
                    │  07 ContextBuilder               │
                    │  08 ToolExecutor                 │
                    │  09 ResponseComposer             │
                    │  06 WorkflowRunner (server half) │
                    │  10 SessionStore                 │
                    └─────────────────────────────────┘
```

---

## Module Index

### Client-Side

| # | Module | One-Line Summary | File |
|---|---|---|---|
| 01 | [ConversationManager](./01-ConversationManager.md) | Entry point for all user messages; manages SSE stream and response delivery | `apps/web/src/lib/conversation.ts` |
| 02 | [SurfaceRegistry](./02-SurfaceRegistry.md) | Routes AI surface update commands to the correct UI controller | `apps/web/src/surfaces/SurfaceRegistry.ts` |
| 03 | [ToolRegistry](./03-ToolRegistry.md) | Catalog of all tools Claude can call; handles registration, validation, and execution | `apps/api/src/tools/registry.ts` |
| 04 | [StateStore](./04-StateStore.md) | Single source of truth for conversation, map, panel, and session state (Zustand) | `apps/web/src/store/index.ts` |
| 05 | [EventBus](./05-EventBus.md) | Bridges UI events (map clicks, draws, form changes) into the conversation | `apps/web/src/lib/eventBus.ts` |
| 06 | [WorkflowEngine](./06-WorkflowEngine.md) | Manages multi-step guided interactions with step tracking and validation | `apps/web/src/lib/WorkflowEngine.ts` |

### Server-Side

| # | Module | One-Line Summary | File |
|---|---|---|---|
| 07 | [ContextBuilder](./07-ContextBuilder.md) | Assembles the full Claude prompt: history, surface snapshot, tool schemas, workflow state | `apps/api/src/orchestration/ContextBuilder.ts` |
| 08 | [ToolExecutor](./08-ToolExecutor.md) | Validates and executes Claude's tool calls; handles parallel batching and self-correction | `apps/api/src/orchestration/ToolExecutor.ts` |
| 09 | [ResponseComposer](./09-ResponseComposer.md) | Translates Claude's output + tool results into the typed AIResponse the client receives | `apps/api/src/orchestration/ResponseComposer.ts` |
| 10 | [SessionStore](./10-SessionStore.md) | Server-side persistence for message history, surface state, and workflow progress | `apps/api/src/session/store.ts` |

---

## How the Modules Fit Together (One Full Request)

```
1.  User types a message
        │
        ▼
2.  ConversationManager.send()
    - Adds user message to StateStore
    - Attaches surface snapshot from StateStore
    - POSTs to /api/chat/message
        │
        ▼
3.  SessionStore.getOrCreate(sessionId)
    - Loads message history and workflow state
        │
        ▼
4.  ContextBuilder.build()
    - Assembles system prompt (rules + surface snapshot + workflow if active)
    - Windows message history to last 20
    - Fetches tool schemas from ToolRegistry
        │
        ▼
5.  Claude API called
    - Returns text + tool_use blocks
        │
        ▼
6.  ToolExecutor.execute(toolCalls)
    - Validates each call against ToolRegistry schemas
    - Runs tools in parallel
    - Handles errors with one self-correction loop
        │
        ▼
7.  ResponseComposer.compose()
    - Extracts text content
    - Collects surface updates from ToolExecutor
    - Derives additional updates from custom tool results
    - Orders updates by priority
    - Extracts workflow events
        │
        ▼
8.  SessionStore updates
    - Appends messages to history
    - Updates surface snapshot
    - Updates workflow state if changed
        │
        ▼
9.  AIResponse streamed back via SSE
        │
        ▼
10. ConversationManager receives response
    - Passes each SurfaceUpdate to SurfaceRegistry
        │
        ▼
11. SurfaceRegistry.dispatch(update)
    - MapSurface.apply(update)   → Mapbox GL JS calls
    - PanelSurface.apply(update) → React renders dynamic UI
        │
        ▼
12. StateStore updated → all subscribed components re-render
        │
        ▼
13. EventBus (for future turns)
    - Map/panel events from user interactions publish here
    - Registered handlers may inject events back into ConversationManager
```

---

## Key Principles

1. **Conversation drives everything.** No UI updates happen without passing through the AI layer first. The map and panel are outputs, not inputs.

2. **Claude uses tools, not free text.** Every AI-driven action is a structured tool call. Nothing is parsed from prose.

3. **The client is the source of truth for UI state.** The server has a cache, but the client's surface snapshot always wins on conflict.

4. **Single store, selective subscriptions.** All client state lives in one Zustand store. Components subscribe only to what they need.

5. **Surfaces are pluggable.** The map is `surface: "map"`. Register any new surface controller and Claude can drive it with the same pattern.

6. **Tools are the API surface.** Everything Claude can do is registered in the ToolRegistry. If it's not registered, Claude can't do it.
