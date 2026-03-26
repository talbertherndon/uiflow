# ContextBuilder

## What It Is

The ContextBuilder is the **server-side module that assembles everything Claude needs to know before each API call**. It is responsible for constructing the full prompt context: the system prompt, the message history, the current surface state, the registered tool schemas, and any active workflow instructions.

The quality of Claude's responses depends almost entirely on the quality of what the ContextBuilder assembles. A well-built context produces accurate tool calls, correct map coordinates, and contextually aware responses. A poorly built context produces hallucinated coordinates, missed tool calls, and responses that ignore what's on screen.

---

## Responsibilities

### 1. Building the System Prompt
The system prompt is the constant instruction layer Claude always reads. The ContextBuilder assembles it dynamically on each call because parts of it change: the surface snapshot, the active workflow, and registered tool descriptions are all variable.

The system prompt has four sections:
- **Role declaration** — who Claude is and what it controls
- **Capability rules** — when to call which tools
- **Current surface state** — what is visible right now (viewport, markers, panel contents)
- **Active workflow** (if any) — the current step, collected data, what's required to advance

### 2. Windowing Message History
The full conversation history cannot always fit in the context window. The ContextBuilder trims the history to the last N messages (default: 20) while preserving the most recent messages exactly. It does not truncate from the bottom — it always includes the user's current message and the most recent AI response.

### 3. Serializing Tool Schemas
Before each call, the ContextBuilder fetches all registered tool definitions from the `ToolRegistry` and formats them as Anthropic-compatible `Tool[]` objects. These are passed as the `tools` parameter to the Claude API, telling Claude exactly what it can call and how.

### 4. Attaching the Surface Snapshot
The surface snapshot — a compact JSON representation of what's currently on screen — is embedded in the system prompt. This is critical: without it, Claude cannot answer questions like "which markers are currently visible?" or "is there already a layer showing zoning data?"

### 5. Injecting Workflow Context
When a workflow is active, the ContextBuilder adds a dedicated `## ACTIVE WORKFLOW` section to the system prompt with the current step, collected data, and what's required to advance. This is re-injected on every turn so Claude never loses track of where it is in the flow.

---

## What It Does NOT Do

- It does not call the Claude API — it only builds the payload
- It does not execute tools — that is the `ToolExecutor`'s job
- It does not manage session state — it reads from the `SessionStore`
- It does not decide which tools to include — it serializes all registered tools

---

## Interface

```typescript
interface ContextBuilder {
  build(request: ChatRequest): ClaudeContext;
}

interface ChatRequest {
  sessionId: string;
  userMessage: string;
  surfaceSnapshot: SurfaceSnapshot;   // Sent by client with every request
  workflowState?: ActiveWorkflowState;
}

interface ClaudeContext {
  system: string;                         // Full assembled system prompt
  messages: Anthropic.MessageParam[];     // Windowed history + current user message
  tools: Anthropic.Tool[];                // All registered tool schemas
  model: string;
  max_tokens: number;
}
```

---

## System Prompt Structure

```
[ROLE]
You are UIFlow, an AI assistant that controls a Mapbox map interface and a
dynamic side panel. You help users explore and interact with location-based data.

[CAPABILITIES]
Map tools available:
- map_set_viewport: Pan and zoom the map to a location
- map_add_markers: Place markers on the map
- map_remove_markers: Remove markers by ID
- map_fit_bounds: Fit map to show all current markers
... (one line per tool)

Panel tools available:
- panel_render_cards: Show results as cards in the side panel
- panel_render_form: Show a form for user input
...

[BEHAVIORAL RULES]
- When a user mentions a place name: ALWAYS call map_set_viewport
- When returning location results: ALWAYS call map_add_markers AND map_fit_bounds
- When showing structured results: ALWAYS call panel_render_cards
- NEVER invent coordinates. Call the geocode tool if you need to resolve a place name.
- Be concise. The map and panel do the showing — your text confirms and explains.
- Never describe what you would do. Do it.

[CURRENT SURFACE STATE]
{
  "map": {
    "viewport": { "center": [-122.4, 37.7], "zoom": 13 },
    "markerCount": 5,
    "visibleMarkers": [
      { "id": "m1", "label": "Blue Bottle Coffee", "coordinates": [-122.401, 37.702] },
      { "id": "m2", "label": "Sightglass Coffee",  "coordinates": [-122.399, 37.698] }
    ],
    "activeLayers": [],
    "drawingActive": false
  },
  "panel": {
    "contentType": "cards",
    "itemCount": 5,
    "activeWorkflowStep": null
  }
}

[ACTIVE WORKFLOW]  ← Only present when workflow is active
Workflow: save_location
Current step: "add_label" (2 of 4)
Collected: { "coordinates": [-122.401, 37.702], "locationName": "Blue Bottle Coffee" }
Required to advance: ["label"]
Step prompt: "What would you like to call this saved location?"
When ready: call workflow_advance_step({ "label": "<value>" })
```

---

## Assembling the Payload

```typescript
class ContextBuilder {
  constructor(
    private toolRegistry: ToolRegistry,
    private sessionStore: SessionStore
  ) {}

  build(request: ChatRequest): ClaudeContext {
    const session = this.sessionStore.get(request.sessionId);

    // 1. System prompt
    const system = this.buildSystemPrompt(request.surfaceSnapshot, request.workflowState);

    // 2. Windowed message history
    const history = session.messages.slice(-20);
    const messages: Anthropic.MessageParam[] = [
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: request.userMessage }
    ];

    // 3. Tool schemas
    const tools = this.toolRegistry.getSchemas();

    return {
      system,
      messages,
      tools,
      model: "claude-opus-4-5",
      max_tokens: 1024
    };
  }

  private buildSystemPrompt(
    snapshot: SurfaceSnapshot,
    workflow?: ActiveWorkflowState
  ): string {
    const parts: string[] = [
      this.roleSection(),
      this.rulesSection(),
      this.surfaceStateSection(snapshot)
    ];

    if (workflow) {
      parts.push(this.workflowSection(workflow));
    }

    return parts.join("\n\n");
  }

  private surfaceStateSection(snapshot: SurfaceSnapshot): string {
    return `[CURRENT SURFACE STATE]\n${JSON.stringify(snapshot, null, 2)}`;
  }

  private workflowSection(workflow: ActiveWorkflowState): string {
    return [
      `[ACTIVE WORKFLOW]`,
      `Workflow: ${workflow.workflowId}`,
      `Current step: "${workflow.stepId}" (${workflow.stepIndex + 1} of ${workflow.totalSteps})`,
      `Collected: ${JSON.stringify(workflow.collectedData)}`,
      `Required to advance: ${JSON.stringify(workflow.requiredFields)}`,
      `Step prompt: "${workflow.stepPrompt}"`,
      `When ready: call workflow_advance_step(${JSON.stringify(Object.fromEntries(workflow.requiredFields.map((f) => [f, "<value>"])))})`
    ].join("\n");
  }
}
```

---

## Surface Snapshot Compression

The surface snapshot must be compact. A verbose snapshot wastes tokens and dilutes Claude's attention. Rules for what to include:

**Map snapshot — include:**
- Current viewport (center, zoom)
- Number of markers currently on the map
- First 5 markers by ID and label only (not full metadata)
- Active layer IDs (as a simple array)
- Whether drawing mode is active

**Map snapshot — exclude:**
- Full marker metadata (only include when Claude needs it, e.g., after a click event)
- Historical viewports
- Layer configuration details

**Panel snapshot — include:**
- Content type currently shown (`"cards"`, `"form"`, `"empty"`, etc.)
- Item count (for cards) or form field count
- Whether a workflow step is active

**Panel snapshot — exclude:**
- Full card content
- Form field values (sent separately as workflow data when relevant)

```typescript
// Compact snapshot — ~200 tokens
{
  "map": {
    "viewport": { "center": [-122.4, 37.7], "zoom": 13 },
    "markerCount": 5,
    "markers": [
      { "id": "m1", "label": "Blue Bottle Coffee" },
      { "id": "m2", "label": "Sightglass Coffee" }
    ],
    "activeLayers": ["transit"],
    "drawingActive": false
  },
  "panel": { "contentType": "cards", "itemCount": 5 }
}
```

---

## Message History Windowing

The window keeps the last 20 messages. But raw truncation can cut off important context mid-workflow. The ContextBuilder applies these rules:

1. **Always include the current user message** (implicit — it's always last)
2. **Always include the last AI response** (so Claude has continuity)
3. **If a workflow is active, always include the message that started it** (even if it's older than 20 turns)
4. **Never cut a tool_use / tool_result pair** — if message 21 is a tool_use, include message 20 (the tool_result) too, even if it pushes past the limit

For Phase 3, this windowing is replaced by a `MemoryManager` that summarizes older context rather than truncating it.

---

## Token Budget Management

The ContextBuilder tracks estimated token usage and adjusts if the payload would exceed limits:

```typescript
private estimateTokens(context: ClaudeContext): number {
  // Rough estimate: 4 chars ≈ 1 token
  const systemTokens = context.system.length / 4;
  const messageTokens = JSON.stringify(context.messages).length / 4;
  const toolTokens = JSON.stringify(context.tools).length / 4;
  return systemTokens + messageTokens + toolTokens;
}

private trimIfNeeded(context: ClaudeContext): ClaudeContext {
  const estimated = this.estimateTokens(context);
  const limit = 180_000; // claude-opus-4-5 context window, leave headroom for response

  if (estimated < limit) return context;

  // Trim history further — remove oldest messages in pairs (user + assistant)
  const trimmed = context.messages.slice(4); // remove oldest 2 turns
  return { ...context, messages: trimmed };
}
```

---

## Key Design Decisions

**Why re-build the system prompt on every call instead of caching it?**
The surface snapshot changes with every user interaction. The workflow state changes every step. A cached system prompt would be stale on the next call. The cost of rebuilding is cheap (string concatenation); the cost of a stale prompt is wrong AI behavior.

**Why include the surface snapshot in the system prompt, not as a user message?**
System prompt content is treated by Claude as persistent contextual instructions, not conversational content. Putting the surface state in the system prompt signals to Claude that this is "what's true right now" rather than something a user said. It also means it doesn't appear in the conversation history.

**Why limit to 20 messages instead of sending the full history?**
Two reasons: token cost and focus. A 200-message history costs significantly more per call and dilutes Claude's attention. Most location-based interactions are context-local — what matters is the last few turns, the current surface state, and (when active) the workflow state. The rolling window captures all of this.

---

## Files

```
apps/api/src/orchestration/ContextBuilder.ts   # Full implementation
apps/api/src/orchestration/prompts.ts           # Role, rules, and template strings
```
