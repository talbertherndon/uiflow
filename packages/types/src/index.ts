// ─── Messages ────────────────────────────────────────────────────────────────

export type Role = "user" | "assistant";

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  surfaceUpdates?: SurfaceUpdate[];
}

// ─── Surfaces ─────────────────────────────────────────────────────────────────

export type SurfaceUpdateOp =
  // Map ops
  | "SET_VIEWPORT"
  | "ADD_MARKERS"
  | "REMOVE_MARKERS"
  | "FIT_BOUNDS"
  | "SET_LAYER"
  | "ADD_SOURCE"
  | "SET_STYLE"
  // Panel ops
  | "RENDER_CARDS"
  | "RENDER_FORM"
  | "RENDER_FILTERS"
  | "RENDER_TABLE"
  | "APPEND_TEXT"
  | "CLEAR";

export interface SurfaceUpdate {
  surface: "map" | "panel" | string;
  op: SurfaceUpdateOp;
  payload: Record<string, unknown>;
}

// ─── Map ──────────────────────────────────────────────────────────────────────

export interface Viewport {
  center: [number, number]; // [lng, lat]
  zoom: number;
  bearing?: number;
  pitch?: number;
}

export interface Marker {
  id: string;
  coordinates: [number, number]; // [lng, lat]
  label: string;
  color?: string;
  metadata?: Record<string, unknown>;
}

export interface MapSource {
  id: string;
  type: "geojson" | "vector" | "raster";
  data: unknown;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export interface CardDefinition {
  id: string;
  title: string;
  subtitle?: string;
  body?: string;
  markerId?: string; // Links card to a map marker for highlight-on-click
  actions?: CardAction[];
  metadata?: Record<string, unknown>;
}

export interface CardAction {
  label: string;
  action: string; // EventBus event name to fire on click
}

export interface FilterField {
  name: string;
  label: string;
  type: "text" | "select" | "range" | "checkbox";
  options?: string[];
}

export interface ColumnDef {
  key: string;
  label: string;
  width?: number;
}

// ─── Tools ───────────────────────────────────────────────────────────────────

export interface ToolResult {
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// ─── Workflows ───────────────────────────────────────────────────────────────

export type WorkflowEventType =
  | "STARTED"
  | "STEP_ADVANCED"
  | "COMPLETED"
  | "CANCELLED";

export interface WorkflowEvent {
  type: WorkflowEventType;
  workflowId: string;
  stepId?: string;
  collectedData?: Record<string, unknown>;
}

// ─── AI Response (server → client contract) ──────────────────────────────────

export interface AIResponse {
  messageId: string;
  content: string;
  surfaceUpdates: SurfaceUpdate[];
  workflowEvent?: WorkflowEvent;
  hasErrors?: boolean;
  tokenUsage?: {
    input: number;
    output: number;
  };
}

// ─── Surface Snapshot (client → server, sent with every request) ─────────────

export interface MapSnapshot {
  viewport: Viewport;
  markerCount: number;
  markers: Array<{ id: string; label: string }>;
  activeLayers: string[];
  drawingActive: boolean;
}

export interface PanelSnapshot {
  contentType: "cards" | "form" | "filters" | "table" | "text" | "empty";
  itemCount: number;
  activeWorkflowStep: string | null;
}

export interface SurfaceSnapshot {
  map: MapSnapshot;
  panel: PanelSnapshot;
}

// ─── Chat Request (client → server) ──────────────────────────────────────────

export interface ChatRequest {
  sessionId: string;
  message: string;
  surfaceSnapshot: SurfaceSnapshot;
}
