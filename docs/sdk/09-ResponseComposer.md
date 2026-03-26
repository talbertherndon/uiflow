# ResponseComposer

## What It Is

The ResponseComposer is the **final assembly step on the server** before the AI response is sent to the client. It takes Claude's raw output (text + tool_use blocks) and the tool execution results from the `ToolExecutor`, and builds the structured `AIResponse` object that the client's `ConversationManager` knows how to process.

It is the translation layer between "what Claude said and did" and "what the client renders and applies." Without it, the client would need to understand Anthropic's raw API response format — with it, the client receives a clean, typed contract.

---

## Responsibilities

### 1. Extracting the Text Content
Claude's response may contain one or more `text` content blocks. The ResponseComposer concatenates them into a single `content` string. This is the message shown to the user in the chat UI.

### 2. Collecting Surface Updates
Custom developer tools (like `search_businesses`) return raw data that needs to be translated into surface commands. The ResponseComposer inspects tool results and determines which surface updates to emit:

- **Built-in map/panel tools** already emit `SurfaceUpdate` objects directly from the ToolExecutor (see ToolExecutor doc). The ResponseComposer just collects and passes these through.
- **Custom tools** return structured data. The ResponseComposer matches their output to surface update patterns. For example, if `search_businesses` returns `{ businesses: [...] }`, the ResponseComposer emits a `panel_render_cards` surface update automatically.

### 3. Ordering Surface Updates
The order of surface updates matters. The ResponseComposer applies these ordering rules:
1. `SET_VIEWPORT` first — the map should move before markers appear
2. `ADD_MARKERS` second — markers land in the right place after the viewport is set
3. `FIT_BOUNDS` third — fits after markers are placed
4. `RENDER_CARDS` last — panel populates after the map is updated

### 4. Forwarding Workflow Events
If any tool call was `workflow_start`, `workflow_advance_step`, `workflow_complete`, or `workflow_cancel`, the ResponseComposer extracts the workflow event and includes it in the `AIResponse` so the client's `WorkflowEngine` can update its state.

### 5. Handling Error States
If tools failed and the self-correction loop was exhausted, the ResponseComposer:
- Includes whatever text Claude produced in `content`
- Omits surface updates for failed tools
- Marks `hasErrors: true` in the response
- Includes an `errorSummary` the client can optionally display

---

## What It Does NOT Do

- It does not call Claude — that happens in the orchestration handler
- It does not execute tools — that is the `ToolExecutor`'s job
- It does not store session state — it just produces a response object
- It does not know about React or the UI — it only knows about the `AIResponse` type

---

## Interface

```typescript
interface ResponseComposer {
  compose(
    claudeResponse: Anthropic.Message,
    toolResults: ToolExecutionResult,
    context: ComposeContext
  ): AIResponse;
}

interface ComposeContext {
  sessionId: string;
  registeredComponents: string[]; // For validating custom component references
}

interface AIResponse {
  messageId: string;
  content: string;                    // Text shown in chat
  surfaceUpdates: SurfaceUpdate[];    // Applied to surfaces in order
  workflowEvent?: WorkflowEvent;      // If a workflow transition occurred
  hasErrors: boolean;
  tokenUsage?: { input: number; output: number };
}
```

---

## Composition Logic

```typescript
class ResponseComposer {
  compose(
    claudeResponse: Anthropic.Message,
    toolResults: ToolExecutionResult,
    context: ComposeContext
  ): AIResponse {
    // 1. Extract text
    const content = claudeResponse.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("\n")
      .trim();

    // 2. Collect surface updates from ToolExecutor
    const surfaceUpdates: SurfaceUpdate[] = [...toolResults.surfaceUpdates];

    // 3. Derive surface updates from custom tool results
    for (const result of toolResults.results) {
      if (!result.success) continue;
      const derived = this.deriveUpdates(result, context);
      surfaceUpdates.push(...derived);
    }

    // 4. Sort by priority
    surfaceUpdates.sort((a, b) => UPDATE_PRIORITY[a.op] - UPDATE_PRIORITY[b.op]);

    // 5. Extract workflow event
    const workflowEvent = this.extractWorkflowEvent(toolResults.results);

    return {
      messageId: crypto.randomUUID(),
      content: content || "Done.",
      surfaceUpdates,
      workflowEvent,
      hasErrors: toolResults.hasErrors,
      tokenUsage: {
        input: claudeResponse.usage.input_tokens,
        output: claudeResponse.usage.output_tokens
      }
    };
  }

  private deriveUpdates(result: ToolResultWithId, context: ComposeContext): SurfaceUpdate[] {
    const updates: SurfaceUpdate[] = [];
    const data = result.data as Record<string, unknown>;

    // search_businesses → render cards + add markers
    if (result.toolName === "search_businesses" && data?.businesses) {
      const businesses = data.businesses as BusinessResult[];

      updates.push({
        surface: "panel",
        op: "RENDER_CARDS",
        payload: {
          cards: businesses.map((b) => ({
            id: b.id,
            title: b.name,
            subtitle: b.address,
            body: b.hours,
            markerId: b.id,  // Links card to marker for highlight-on-click
            metadata: b
          }))
        }
      });

      updates.push({
        surface: "map",
        op: "ADD_MARKERS",
        payload: {
          markers: businesses.map((b) => ({
            id: b.id,
            coordinates: b.coordinates,
            label: b.name,
            color: "#3B82F6"
          }))
        }
      });
    }

    return updates;
  }

  private extractWorkflowEvent(results: ToolResultWithId[]): WorkflowEvent | undefined {
    const workflowTools = ["workflow_start", "workflow_advance_step", "workflow_complete", "workflow_cancel"];

    for (const result of results) {
      if (workflowTools.includes(result.toolName) && result.success) {
        return {
          type: WORKFLOW_TOOL_TO_EVENT[result.toolName],
          workflowId: (result.data as { workflowId: string }).workflowId,
          stepId: (result.data as { stepId?: string }).stepId
        };
      }
    }
  }
}

// Surface update execution priority
const UPDATE_PRIORITY: Record<string, number> = {
  SET_VIEWPORT: 1,   // Move map first
  ADD_MARKERS: 2,    // Then place markers
  FIT_BOUNDS: 3,     // Then fit to markers
  SET_LAYER: 4,
  RENDER_CARDS: 5,   // Panel last
  RENDER_FORM: 5,
  RENDER_FILTERS: 5,
  CLEAR: 0           // Clear always runs first if present
};
```

---

## Auto-Derivation: Custom Tools → Surface Updates

The most powerful part of the ResponseComposer is auto-derivation: the ability to infer surface updates from custom tool results without Claude explicitly calling a panel or map tool.

This works through a **derivation registry** — a set of rules that map tool names and result shapes to surface updates.

```typescript
sdk.registerDerivation({
  forTool: "search_businesses",
  derive: (result) => {
    if (!result.data?.businesses?.length) return [];
    return [
      {
        surface: "panel",
        op: "RENDER_CARDS",
        payload: { cards: result.data.businesses.map(toCard) }
      },
      {
        surface: "map",
        op: "ADD_MARKERS",
        payload: { markers: result.data.businesses.map(toMarker) }
      }
    ];
  }
});
```

This means Claude only needs to call `search_businesses` — it does NOT also need to call `panel_render_cards` and `map_add_markers`. The derivation rule handles that translation. This simplifies Claude's decision-making and reduces the number of tool calls per response.

Alternatively, developers can let Claude call all three tools explicitly if they want full control. Both approaches work.

---

## SSE Streaming

For streaming responses, the ResponseComposer works incrementally:

```
Claude streams response chunks via SSE:

chunk 1: { type: "content_block_start", content_block: { type: "text" } }
chunk 2: { type: "content_block_delta", delta: { text: "Here are " } }
chunk 3: { type: "content_block_delta", delta: { text: "coffee shops" } }
chunk 4: { type: "content_block_stop" }
chunk 5: { type: "content_block_start", content_block: { type: "tool_use", name: "map_add_markers" } }
chunk 6: { type: "content_block_delta", delta: { partial_json: '{"markers":' } }
...tool JSON accumulates...
chunk N: { type: "message_stop" }
```

The orchestration handler:
1. Streams text chunks directly to the client SSE stream as they arrive (`event: text_delta`)
2. Accumulates tool_use JSON in a buffer until the block is complete
3. When a tool_use block completes: validates + executes the tool, then emits the surface update as a mid-stream SSE event (`event: surface_update`)
4. When the full response is done: sends `event: stream_end` with final metadata

This means the map starts updating **while Claude is still generating text**, which makes the experience feel fast.

---

## Error Response Format

When tools fail and the user needs to know:

```typescript
// AIResponse when a tool fails
{
  messageId: "...",
  content: "I wasn't able to find businesses right now — the search service seems to be unavailable. You can try again or let me know if you'd like to try something else.",
  surfaceUpdates: [],  // No updates if the tool that would drive them failed
  hasErrors: true,
  errorSummary: {
    failedTools: ["search_businesses"],
    reason: "External API returned 503"
  }
}
```

Claude generates the user-facing error message naturally — the ResponseComposer doesn't write error messages, it just surfaces the `hasErrors` flag. Claude knows a tool failed (from the `tool_result` block with `is_error: true`) and generates an appropriate apology/explanation.

---

## Key Design Decisions

**Why auto-derive surface updates instead of having Claude call all tools explicitly?**
Fewer tool calls = faster responses and less complexity in Claude's decision-making. If searching for businesses always results in showing cards and markers, there's no reason to make Claude call three separate tools every time. Auto-derivation collapses a common pattern into one call. Developers can override derivation for custom behavior.

**Why order surface updates by priority instead of applying them in call order?**
Claude doesn't always call tools in the "right" order. Sometimes `ADD_MARKERS` comes before `SET_VIEWPORT` in Claude's output. If applied in call order, markers would land at wrong positions before the viewport move. Priority ordering makes the output predictable regardless of Claude's call order.

**Why does the ResponseComposer handle workflow events?**
Workflow events are conveyed through tool calls (`workflow_start`, etc.), but they need to be surfaced as a first-class field in `AIResponse` rather than buried in tool results. The ResponseComposer promotes them to the top level so the client's `WorkflowEngine` doesn't have to scan through all tool results looking for workflow transitions.

---

## Files

```
apps/api/src/orchestration/ResponseComposer.ts   # Main composition logic
apps/api/src/orchestration/derivations.ts         # Built-in and custom derivation rules
apps/api/src/orchestration/streamHandler.ts       # SSE streaming + incremental composition
```
