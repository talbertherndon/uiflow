# ToolRegistry

## What It Is

The ToolRegistry is the **catalog of everything Claude is allowed to do**. Every capability the AI can invoke — searching for places, saving data, calling external APIs, mutating map state — must be registered here first. If a tool is not registered, Claude cannot call it.

The registry serves two purposes simultaneously:
1. **Runtime execution** — when Claude calls a tool, the registry finds the implementation and runs it
2. **Schema advertisement** — the registry serializes all tool definitions into JSON Schema that gets sent to Claude with every request, so Claude knows what tools exist and how to call them

This dual role means the registry is the contract between what Claude *can do* and what the system will *actually execute*.

---

## Responsibilities

### 1. Registering Tools
Developers register tools with a name, a natural-language description Claude reads to decide whether to call the tool, a JSON Schema for parameters, and an execute function.

### 2. Validating Tool Calls
Before executing any tool, the registry validates Claude's input against the registered JSON Schema using Zod. If Claude passes wrong types or missing required fields, the error is caught here and returned to Claude for self-correction — the tool is not executed.

### 3. Executing Tools
Once validated, the registry calls the tool's `execute` function with the typed parameters. It handles async execution, timeouts, and wraps errors in a structured `ToolResult` so the `ResponseComposer` can relay failures back to Claude cleanly.

### 4. Serializing Schemas for Claude
The `ContextBuilder` calls `registry.getSchemas()` before each Claude API call. The registry returns all registered tools as Anthropic-compatible `Tool[]` objects (JSON Schema format) that get included in the `tools` parameter of the API call.

### 5. Managing Tool Side Effects
Some tools have side effects that need special handling:
- **Confirmation-required tools** — destructive operations (delete, send, publish) that require the user to explicitly confirm before executing
- **Client-side tools** — tools that run in the browser (geolocation, file access) rather than on the server
- **Streaming tools** — tools that produce incremental output (e.g., a report generator that streams results)

The registry tracks these flags and the `ToolExecutor` honors them at runtime.

---

## What It Does NOT Do

- It does not decide *which* tools to call — Claude decides that
- It does not know about the map or panel — it only handles tool execution
- It does not manage conversation state — that lives in the `StateStore`
- It does not call the Claude API — it only responds when Claude has already decided to call a tool

---

## Interface

```typescript
interface ToolDefinition<TParams = Record<string, unknown>> {
  name: string;
  description: string;       // What Claude reads to decide whether to use this tool
  parameters: JSONSchema;    // Validated before execution; serialized for Claude
  execute: (params: TParams, context: ToolContext) => Promise<ToolResult>;
  side?: "server" | "client" | "both"; // Default: "server"
  requiresConfirmation?: boolean;       // Default: false
  timeout?: number;                     // ms, default: 10000
}

interface ToolContext {
  sessionId: string;
  userId?: string;
  surfaceSnapshot: SurfaceSnapshot;
}

interface ToolResult {
  toolName: string;
  success: boolean;
  data?: unknown;       // Returned to Claude as tool result content
  error?: string;       // If success: false, Claude sees this and can self-correct
  requiresConfirmation?: ConfirmationRequest; // If tool needs user approval
}

interface ToolRegistry {
  register(tool: ToolDefinition): void;
  unregister(name: string): void;
  getSchemas(): Anthropic.Tool[];                         // For ContextBuilder
  execute(name: string, params: unknown, ctx: ToolContext): Promise<ToolResult>;
  validate(name: string, params: unknown): ValidationResult;
}
```

---

## Built-in Tools (Registered by SDK)

These are automatically available — developers do not need to register them.

### Map Control Tools
| Tool | Description |
|---|---|
| `map_set_viewport` | Pan and zoom to a location |
| `map_add_markers` | Place markers on the map |
| `map_remove_markers` | Remove markers by ID |
| `map_fit_bounds` | Fit map to contain all current markers |
| `map_set_layer` | Toggle or configure a Mapbox layer |
| `map_add_source` | Add a GeoJSON or tile source |
| `map_draw_polygon` | Activate drawing mode, capture drawn polygon |
| `map_set_style` | Switch map style (streets, satellite, etc.) |

### Panel Control Tools
| Tool | Description |
|---|---|
| `panel_render_cards` | Render a list of cards in the side panel |
| `panel_render_form` | Render a JSON Schema-defined form |
| `panel_render_filters` | Render a filter bar |
| `panel_render_table` | Render a data table |
| `panel_append_text` | Stream markdown text into the panel |
| `panel_clear` | Reset panel to empty |

### Workflow Tools
| Tool | Description |
|---|---|
| `workflow_start` | Begin a registered multi-step workflow |
| `workflow_advance_step` | Move to the next step with collected data |
| `workflow_complete` | Finalize and submit a workflow |
| `workflow_cancel` | Abort the current workflow |

### Utility Tools
| Tool | Description |
|---|---|
| `geocode` | Resolve a place name to coordinates (Mapbox Geocoding API) |
| `ask_clarification` | Ask the user a follow-up question before acting |
| `confirm_action` | Request explicit user confirmation before a destructive action |

---

## Registering a Custom Tool

```typescript
sdk.registerTool({
  name: "search_businesses",
  description: `Search for businesses by type and location.
    Use when the user asks to find places, shops, restaurants, cafes, or services near a location.
    Returns a list of businesses with coordinates, name, address, and hours.`,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Business type or name (e.g., 'coffee shop', 'pharmacy', 'Blue Bottle')"
      },
      location: {
        type: "object",
        properties: {
          lat:          { type: "number" },
          lng:          { type: "number" },
          radiusMeters: { type: "number", description: "Search radius. Default: 1000" }
        },
        required: ["lat", "lng"]
      },
      limit: { type: "number", description: "Max results. Default: 10, max: 50" }
    },
    required: ["query", "location"]
  },
  execute: async ({ query, location, limit = 10 }) => {
    const results = await placesAPI.search(query, location, limit);
    return {
      success: true,
      data: {
        businesses: results.map((r) => ({
          id: r.id,
          name: r.name,
          address: r.address,
          coordinates: [r.lng, r.lat],
          hours: r.hours,
          rating: r.rating
        })),
        count: results.length
      }
    };
  }
});
```

---

## Registering a Confirmation-Required Tool

```typescript
sdk.registerTool({
  name: "delete_saved_location",
  description: "Permanently delete a saved location from the user's collection.",
  parameters: {
    type: "object",
    properties: {
      locationId: { type: "string" }
    },
    required: ["locationId"]
  },
  requiresConfirmation: true,   // User must approve before this runs
  execute: async ({ locationId }) => {
    await db.savedLocations.delete(locationId);
    return { success: true, data: { deleted: locationId } };
  }
});
```

When Claude calls this tool, the flow pauses:
1. The registry returns a `requiresConfirmation` response instead of executing
2. The `PanelSurface` renders a confirmation dialog
3. The user approves or rejects
4. If approved, the tool executes; if rejected, Claude is told the user declined

---

## Tool Description Writing Guide

The `description` field is what Claude reads to decide whether and how to call a tool. Bad descriptions lead to missed tool calls or wrong parameters.

**Rules for good descriptions:**
- Start with a verb: "Search for...", "Retrieve...", "Add...", "Delete..."
- Say *when* to use it, not just what it does: "Use when the user asks to find..."
- Describe what the output looks like: "Returns a list of businesses with coordinates..."
- Note limitations or requirements: "Requires coordinates — call geocode first if you only have a place name"
- Keep it under 200 words

**Bad description:**
```
"search_businesses - searches businesses"
```

**Good description:**
```
"Search for businesses by type and location. Use when the user asks to find
places, shops, restaurants, cafes, or any kind of service near a location.
Requires lat/lng coordinates — if the user gives a place name instead of
coordinates, call geocode first. Returns businesses with name, address,
coordinates, hours, and rating."
```

---

## Tool Execution Flow

```
Claude returns tool_use block:
  { name: "search_businesses", input: { query: "coffee", location: { lat: 37.7, lng: -122.4 } } }
    │
    ▼
ToolRegistry.validate("search_businesses", input)
  → Zod schema check
  → If invalid: return ValidationError → injected back to Claude
    │
    ▼
Check: requiresConfirmation?
  → Yes: pause, surface confirmation dialog, await user response
  → No: proceed
    │
    ▼
ToolRegistry.execute("search_businesses", validatedInput, context)
  → Calls execute({ query: "coffee", location: { lat: 37.7, lng: -122.4 } })
  → Awaits result with timeout
    │
    ▼
Returns ToolResult { success: true, data: { businesses: [...], count: 8 } }
    │
    ▼
ToolExecutor aggregates all tool results
    │
    ▼
ResponseComposer uses results to build surfaceUpdates + AI follow-up response
```

---

## Key Design Decisions

**Why JSON Schema for parameters instead of TypeScript types?**
JSON Schema travels across the network to Claude. TypeScript types are compile-time only. By defining parameters as JSON Schema, the same definition serves as both the runtime validator and the schema advertised to Claude. The developer writes it once.

**Why does Claude decide which tools to call, not the developer?**
This is the core philosophy of UIFlow. The developer registers capabilities; Claude decides when to use them based on user intent. This means adding a new tool automatically makes Claude smarter without the developer writing any intent-matching logic.

**Why not auto-generate descriptions from parameter schemas?**
Auto-generated descriptions are too mechanical. The description field is how you teach Claude *when* to use a tool, not just what it does. This requires human judgment about the use cases the tool covers. Poor descriptions are the #1 cause of Claude calling the wrong tool or missing a call entirely.

---

## Files

```
apps/api/src/tools/registry.ts         # ToolRegistry class
apps/api/src/tools/map.tools.ts        # Built-in map control tools
apps/api/src/tools/panel.tools.ts      # Built-in panel control tools
apps/api/src/tools/workflow.tools.ts   # Built-in workflow tools
apps/api/src/tools/utility.tools.ts    # geocode, ask_clarification, confirm_action
apps/api/src/tools/example/search.ts   # Example: search_businesses
```
