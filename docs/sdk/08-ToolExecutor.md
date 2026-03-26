# ToolExecutor

## What It Is

The ToolExecutor is the **server-side engine that runs tool calls produced by Claude**. When Claude returns a response with `tool_use` content blocks, the ToolExecutor receives those blocks, validates each one, runs them in the correct order, handles errors, and returns structured results that the `ResponseComposer` can use.

It is the only place in the system where tools actually execute. Nothing runs before it validates; nothing runs without being registered.

---

## Responsibilities

### 1. Receiving Claude's Tool Calls
After the Claude API responds, the response contains one or more `tool_use` content blocks. Each block has:
- `name`: the registered tool name
- `input`: the parameters Claude decided to pass (unvalidated)

The ToolExecutor receives all tool_use blocks from a single response as a batch.

### 2. Validating Parameters
Before executing any tool, the ToolExecutor calls `ToolRegistry.validate(name, input)`. This runs the registered JSON Schema validator (Zod) against Claude's input. If validation fails:
- The tool is NOT executed
- A `ToolResult` with `success: false` and a descriptive error is returned
- The error is fed back to Claude in a follow-up turn so it can self-correct

This prevents a wide class of bugs where Claude passes the wrong type (e.g., `"10"` instead of `10`) or misses a required field.

### 3. Dependency Resolution and Parallel Batching
Not all tools in a response need to run sequentially. The ToolExecutor groups tools into batches:

- **Independent tools** (no dependency between them) → run in parallel with `Promise.all`
- **Dependent tools** (one needs the output of another) → run sequentially

For MVP, all tools in a response are treated as independent and run in parallel. In Phase 2, explicit dependency declarations can be added.

```typescript
// These three tools from a single AI response run in parallel:
// map_set_viewport, map_add_markers, panel_render_cards
// None of their outputs depend on each other.

// These must be sequential:
// geocode (needs to resolve coordinates first)
// → map_add_markers (uses the coordinates from geocode)
```

### 4. Handling Confirmations
If a tool is registered with `requiresConfirmation: true`, the ToolExecutor:
1. Does NOT execute the tool
2. Returns a `ToolResult` with `requiresConfirmation: ConfirmationRequest`
3. The `ResponseComposer` surfaces a confirmation dialog in the panel
4. Execution is paused until the user approves or rejects
5. On approval, the ToolExecutor re-runs with a `confirmed: true` flag

### 5. Error Recovery Loop
When a tool fails (network error, external API down, timeout), the ToolExecutor:
1. Catches the error and wraps it in `ToolResult { success: false, error: "..." }`
2. Feeds the failure result back to Claude as a `tool_result` content block
3. Asks Claude to retry or use an alternative approach
4. Caps retries at 1 — if Claude fails twice on the same tool, the error surfaces to the user

This self-correction loop handles transient failures and Claude's occasional parameter mistakes without requiring user intervention.

### 6. Timeouts
Each tool has a configurable timeout (default: 10 seconds). If a tool's `execute` function doesn't resolve within the timeout, the ToolExecutor:
- Cancels the pending call
- Returns `{ success: false, error: "Tool timed out after 10s" }`
- Proceeds with other tools in the batch

---

## What It Does NOT Do

- It does not decide which tools to call — Claude decides that
- It does not construct the response message — that is `ResponseComposer`
- It does not manage retries at the HTTP layer — it manages retries at the tool layer
- It does not know about the map or panel — it only knows about tools and their results

---

## Interface

```typescript
interface ToolExecutor {
  execute(
    toolCalls: ToolCall[],
    context: ToolContext
  ): Promise<ToolExecutionResult>;
}

interface ToolCall {
  id: string;      // Claude's tool_use block ID (returned in tool_result)
  name: string;
  input: unknown;
}

interface ToolExecutionResult {
  results: ToolResultWithId[];
  requiresConfirmation?: ConfirmationRequest;
  hasErrors: boolean;
  surfaceUpdates: SurfaceUpdate[]; // Built-in tools (map, panel) emit these directly
}

interface ToolResultWithId {
  toolUseId: string;      // Matches Claude's tool_use block ID
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface ConfirmationRequest {
  toolName: string;
  toolUseId: string;
  message: string;        // Shown to user: "Are you sure you want to delete this?"
  params: unknown;        // The validated params, ready to execute if confirmed
}
```

---

## Execution Flow

```typescript
class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private context: ToolContext
  ) {}

  async execute(toolCalls: ToolCall[]): Promise<ToolExecutionResult> {
    const results: ToolResultWithId[] = [];
    const surfaceUpdates: SurfaceUpdate[] = [];

    // Run all tool calls in parallel (MVP: no dependency resolution)
    const executions = toolCalls.map(async (call) => {

      // 1. Look up the tool
      const tool = this.registry.get(call.name);
      if (!tool) {
        return {
          toolUseId: call.id,
          toolName: call.name,
          success: false,
          error: `Unknown tool: ${call.name}`
        };
      }

      // 2. Validate params
      const validation = this.registry.validate(call.name, call.input);
      if (!validation.success) {
        return {
          toolUseId: call.id,
          toolName: call.name,
          success: false,
          error: `Invalid parameters: ${validation.error}`
        };
      }

      // 3. Check confirmation requirement
      if (tool.requiresConfirmation && !call.confirmed) {
        return {
          toolUseId: call.id,
          toolName: call.name,
          success: false,
          requiresConfirmation: {
            toolName: call.name,
            toolUseId: call.id,
            message: `Are you sure you want to run "${call.name}"?`,
            params: validation.data
          }
        };
      }

      // 4. Execute with timeout
      try {
        const result = await Promise.race([
          tool.execute(validation.data, this.context),
          this.timeout(tool.timeout ?? 10_000, call.name)
        ]);

        // Built-in surface tools emit SurfaceUpdates as part of their result
        if (result.surfaceUpdate) {
          surfaceUpdates.push(result.surfaceUpdate);
        }

        return {
          toolUseId: call.id,
          toolName: call.name,
          success: true,
          data: result.data
        };

      } catch (err) {
        return {
          toolUseId: call.id,
          toolName: call.name,
          success: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    });

    const allResults = await Promise.allSettled(executions);
    allResults.forEach((r) => {
      if (r.status === "fulfilled") results.push(r.value);
    });

    return {
      results,
      surfaceUpdates,
      hasErrors: results.some((r) => !r.success)
    };
  }

  private timeout(ms: number, toolName: string): Promise<never> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${toolName} timed out after ${ms}ms`)), ms)
    );
  }
}
```

---

## Self-Correction Loop

When tool calls fail, the ToolExecutor feeds errors back to Claude as `tool_result` blocks. Claude reads these and can correct its approach:

```typescript
// After tools run with errors, the handler re-invokes Claude with tool results:

const toolResultMessages: Anthropic.MessageParam[] = [
  // The assistant's original message with tool_use blocks
  { role: "assistant", content: response.content },
  // The tool results (some may be errors)
  {
    role: "user",
    content: results.map((r) => ({
      type: "tool_result",
      tool_use_id: r.toolUseId,
      content: r.success
        ? JSON.stringify(r.data)
        : `ERROR: ${r.error}. Please correct and try again.`,
      is_error: !r.success
    }))
  }
];

// Claude sees the errors and produces a corrected response
const correctedResponse = await claude.messages.create({
  ...context,
  messages: [...context.messages, ...toolResultMessages]
});
```

**Example correction:**
- First call: Claude calls `map_add_markers` with `coordinates: "37.7, -122.4"` (a string instead of an array)
- ToolExecutor validation fails: `"coordinates must be an array of numbers"`
- Error fed back to Claude
- Second call: Claude calls `map_add_markers` with `coordinates: [37.7, -122.4]` (correct)

---

## How Built-in Tools Emit Surface Updates

Built-in map and panel tools are a special case: instead of returning data for the `ResponseComposer` to interpret, they return a `surfaceUpdate` directly. This is an optimization — for simple map commands, there is nothing to "compose"; the update IS the result.

```typescript
// Built-in: map_set_viewport
{
  name: "map_set_viewport",
  execute: async (params) => ({
    success: true,
    data: { applied: true },
    surfaceUpdate: {
      surface: "map",
      op: "SET_VIEWPORT",
      payload: { center: params.center, zoom: params.zoom }
    }
  })
}
```

Custom developer tools return `data` only — the `ResponseComposer` decides what surface update (if any) to emit based on the tool's output.

---

## Logging

Every tool execution is logged to the `SessionStore`:

```typescript
{
  sessionId: "abc123",
  toolName: "search_businesses",
  calledAt: 1711234567890,
  success: true,
  durationMs: 342,
  inputSummary: { query: "coffee", location: "37.7, -122.4", limit: 10 },
  resultSummary: { count: 8 }
}
```

These logs are:
- Accessible via `GET /api/session/:id/tools` for debugging
- Surfaced in the dev panel (Phase 2)
- Used to detect patterns like "this tool is failing 30% of the time" (Phase 3)

---

## Key Design Decisions

**Why validate before every execution, even if Claude usually gets it right?**
Claude occasionally passes wrong types, especially for nested objects. Validation catches these before they reach the execute function where they could cause cryptic errors or corrupt data. The cost of a Zod parse is microseconds; the cost of debugging a corrupted database record is not.

**Why parallel execution by default?**
Most tool calls in a response are independent: `map_set_viewport` doesn't need to wait for `panel_render_cards`. Parallel execution cuts total response time roughly in half when 2-3 tools fire together. Sequential execution is the safe fallback for explicitly dependent tools (Phase 2).

**Why cap retries at 1?**
A single self-correction loop catches ~95% of parameter mistakes. Beyond one retry, you are likely in a case where the tool genuinely cannot be called correctly with the current input (e.g., the external API is down, or the user's request is ambiguous). Further retries just increase latency and cost. Better to surface the failure and let the user rephrase.

---

## Files

```
apps/api/src/orchestration/ToolExecutor.ts    # Main executor class
apps/api/src/orchestration/validator.ts        # Zod-based parameter validation
apps/api/src/orchestration/timeout.ts          # Timeout utility
```
