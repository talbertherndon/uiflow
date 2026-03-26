# WorkflowEngine

## What It Is

The WorkflowEngine manages **multi-step interactions** where completing a goal requires collecting information or confirming actions across multiple conversation turns. It gives the AI a structured framework for guiding users through processes that have a defined sequence, validation rules, and a final outcome.

Without the WorkflowEngine, Claude can still have multi-turn conversations — but they are freeform. The AI might forget what it was collecting, skip steps, or ask for the same information twice. The WorkflowEngine gives structure to these interactions by tracking exactly what has been collected, what step is active, and what needs to happen next.

---

## The Problem It Solves

Consider: "I want to save this location to my favorites."

This requires:
1. Confirming which location (or letting the user click one on the map)
2. Getting a label for it
3. Choosing a category (work, home, food, etc.)
4. Confirming before saving

Without a workflow, Claude might handle this inconsistently — sometimes asking all at once in a list, sometimes forgetting the category, sometimes saving without confirmation.

With a workflow:
- Steps are defined once by the developer
- The `WorkflowEngine` tracks which step is active
- Each message turn, the active step context is injected into Claude's prompt
- Claude can only advance to the next step when the current step's data is valid
- The final `onComplete` fires when all steps are done

---

## Architecture: Client and Server

The WorkflowEngine is split across two layers:

**Client-side (`WorkflowEngine`):** Tracks the active workflow in the `StateStore`. Updates the panel UI to show step progress. Forwards step events to the server. Listens for workflow events in AI responses.

**Server-side (`WorkflowRunner`):** Registered workflow definitions live here. Injects the active step context into every Claude prompt. Validates step completion. Advances state. Fires `onComplete` callbacks.

They stay in sync because every AI request includes the current workflow state (step ID, collected data), and every AI response may include a `workflowEvent` that transitions the state.

---

## Workflow Lifecycle

```
Developer registers workflow "save_location"
    │
User says "save this place"
    │
    ▼
Claude calls: workflow_start({ id: "save_location" })
    │
    ▼
WorkflowRunner activates workflow:
  currentStep = "confirm_location"
  collectedData = {}
    │
WorkflowEngine (client) receives workflow_start event:
  StateStore.setActiveWorkflow({ workflowId, stepId: "confirm_location", ... })
  PanelSurface renders step UI
    │
    ▼
── STEP LOOP ──────────────────────────────────────────────────────
    │
Each subsequent message:
  ContextBuilder injects step context into Claude's prompt
  Claude guides the user through the current step
  When user provides required data, Claude calls: workflow_advance_step({ data })
    │
    ▼
WorkflowRunner validates step data
  → Invalid: returns error, Claude asks again
  → Valid: advances to next step, injects new step context
    │
    ▼
WorkflowEngine (client) receives step_advanced event:
  StateStore.setActiveWorkflow({ stepId: "next_step", ... })
  PanelSurface updates to show new step
    │
    ▼
Repeat until all steps complete
── END STEP LOOP ───────────────────────────────────────────────────
    │
    ▼
Claude calls: workflow_complete({ finalData })
    │
    ▼
WorkflowRunner fires onComplete(collectedData)
WorkflowEngine (client): StateStore.setActiveWorkflow(null)
PanelSurface returns to normal mode
```

---

## Workflow Definition

```typescript
interface WorkflowDefinition {
  id: string;
  description: string;   // Shown to Claude so it knows when to trigger this workflow
  steps: WorkflowStep[];
  onComplete: (data: CollectedData, context: WorkflowContext) => Promise<void>;
  onCancel?: (data: Partial<CollectedData>) => void;
  allowOutOfOrder?: boolean; // Default: false — steps must complete in sequence
}

interface WorkflowStep {
  id: string;
  prompt: string;           // Instruction Claude shows to the user for this step
  description?: string;     // Optional extra context for Claude (not shown to user)
  required: string[];       // Field names that must be in collectedData to advance
  schema?: JSONSchema;      // Validation schema for this step's fields
  ui?: StepUI;              // Optional panel UI override for this step
}

interface StepUI {
  type: "form" | "map_click" | "choice" | "confirmation";
  config?: Record<string, unknown>; // Extra config passed to the panel renderer
}

interface WorkflowContext {
  sessionId: string;
  sdk: UIFlowSDK;
}
```

---

## Registering a Workflow

```typescript
sdk.registerWorkflow({
  id: "save_location",
  description: "Guide the user through saving a location to their favorites. Start this when the user says 'save this', 'add to favorites', or 'bookmark this location'.",
  steps: [
    {
      id: "confirm_location",
      prompt: "Which location would you like to save? You can click a marker on the map, or tell me the address.",
      required: ["coordinates", "locationName"],
      ui: { type: "map_click" }
    },
    {
      id: "add_label",
      prompt: "What would you like to call this saved location?",
      required: ["label"],
      schema: {
        type: "object",
        properties: {
          label: { type: "string", minLength: 1, maxLength: 50 }
        }
      },
      ui: { type: "form", config: { field: "label", placeholder: "e.g. Home, Office, Favorite Coffee Shop" } }
    },
    {
      id: "choose_category",
      prompt: "What category fits best?",
      required: ["category"],
      ui: {
        type: "choice",
        config: {
          options: ["Home", "Work", "Food & Drink", "Shopping", "Entertainment", "Other"]
        }
      }
    },
    {
      id: "confirm",
      prompt: "Ready to save this location?",
      required: [],
      ui: { type: "confirmation" }
    }
  ],
  onComplete: async ({ coordinates, locationName, label, category }, { sdk }) => {
    await sdk.tools.execute("save_location_to_db", {
      coordinates,
      name: label,
      originalName: locationName,
      category
    });
  },
  onCancel: ({ label }) => {
    console.log(`User cancelled saving: ${label ?? "unnamed location"}`);
  }
});
```

---

## How Step Context Is Injected into Claude

The `ContextBuilder` adds a `WORKFLOW` section to the system prompt whenever a workflow is active:

```
## ACTIVE WORKFLOW: save_location
Current step: "add_label" (2 of 4)
Collected so far: {
  "coordinates": [-122.401, 37.702],
  "locationName": "Blue Bottle Coffee"
}

Step instruction: "What would you like to call this saved location?"
Required to advance: ["label"]

When the user provides a label, call workflow_advance_step({ "label": "<value>" }).
Do not advance until you have the required fields.
Do not skip steps.
```

This block is prepended before the conversation history on every turn during a workflow.

---

## Client-Side State

The `WorkflowEngine` syncs workflow state into the `StateStore.PanelState.activeWorkflow` slice:

```typescript
interface ActiveWorkflow {
  workflowId: string;
  stepId: string;
  stepIndex: number;       // 0-based
  totalSteps: number;
  collectedData: Record<string, unknown>;
  stepPrompt: string;      // Display text for current step
  stepUIType: StepUI["type"];
}
```

The `PanelSurface` watches `activeWorkflow` and renders a step-aware panel:
- **Progress bar** showing step N of M
- **Step prompt** displayed prominently
- **Step-specific UI** (form, map click prompt, choice buttons, confirmation buttons)
- **Cancel button** that calls `workflow_cancel`

---

## Panel UI per Step Type

| Step `ui.type` | What Renders |
|---|---|
| `form` | An inline form with the fields defined in the step schema |
| `map_click` | A prompt ("Click on the map to select") + map enters click-to-select mode |
| `choice` | A set of large tap-target buttons for the user to pick from |
| `confirmation` | A summary of collected data + "Confirm" and "Cancel" buttons |

If no `ui` is defined for a step, the panel shows the step prompt and lets the user respond via the chat input.

---

## Map Click Mode in Workflows

When a step has `ui: { type: "map_click" }`, the `WorkflowEngine` puts the map into a special selection mode:
- The cursor changes to a crosshair
- A hint tooltip appears: "Click anywhere on the map to select a location"
- When the user clicks, the `EventBus` fires `map.workflow_pick`
- The `WorkflowEngine` receives this, stores `{ coordinates, locationName }` in `collectedData`, and calls `workflow_advance_step` automatically — no user typing needed

---

## Error and Edge Cases

**User types off-script during a workflow:**
Claude receives both the active workflow context and the user's message. If the user asks an unrelated question mid-workflow ("actually what time does this place close?"), Claude can answer briefly and then redirect: "I also still need a label for the location you're saving — what would you like to call it?"

**Validation failure:**
If `workflow_advance_step` is called with missing or invalid required fields, the server returns a validation error. Claude receives the error and asks the user to provide the correct information. The step does not advance.

**User cancels:**
The user can say "never mind" or click the Cancel button. Claude calls `workflow_cancel`. The `WorkflowEngine` clears `activeWorkflow` from the store, fires `onCancel` with whatever data was collected, and the panel returns to normal mode.

**Session disconnect:**
The active workflow state is stored in the server-side `SessionStore`. If the user refreshes, the active workflow is restored from session state on the next message.

---

## Key Design Decisions

**Why define workflows on the server, not in Claude's prompt?**
Workflow definitions are code — they have validation logic, schema, and `onComplete` callbacks. They cannot live purely in a prompt. The server-side `WorkflowRunner` is the authoritative state machine; Claude is the conversational layer that guides the user through it.

**Why inject step context into every message, not just once?**
Claude's context window is stateless between calls. If you tell Claude "you're on step 2" only once, it may forget by turn 10. Re-injecting the workflow context on every turn ensures Claude always knows exactly what step it's on and what's required, regardless of how long the conversation runs.

**Why not just let Claude manage multi-step flows freeform?**
Claude can do multi-step conversations naturally — but without a structured workflow, there's no reliable `onComplete` callback, no way to validate that all required fields were collected, and no guarantee the user wasn't redirected down a different path mid-flow. The workflow gives developers a dependable contract: when `onComplete` fires, you have all the data you need, validated.

---

## Files

```
apps/api/src/orchestration/WorkflowRunner.ts   # Server-side state machine
apps/web/src/lib/WorkflowEngine.ts              # Client-side workflow tracking
apps/web/src/hooks/useWorkflow.ts               # React hook for workflow state
apps/web/src/components/panel/WorkflowPanel.tsx # Step UI renderer
```
