# SessionStore

## What It Is

The SessionStore is the **server-side persistence layer for conversation and surface state**. It holds everything the server needs to remember between requests: the message history, the last known surface snapshot, the active workflow state, and the tool execution log.

Because the server is stateless at the HTTP layer (each request stands alone), the SessionStore is what gives the system memory between turns. Without it, Claude would have no conversation history on the next request — every message would feel like the first.

---

## Responsibilities

### 1. Storing Message History
Every message (user and assistant) is appended to the session's history. The `ContextBuilder` reads this history on every request to include recent conversation context in Claude's prompt.

### 2. Caching the Surface Snapshot
The server stores its own copy of the surface state (map viewport, active markers, workflow state). This serves as a fallback if the client doesn't send a snapshot and as the authoritative record for the tool execution log.

**Important:** The client always sends its own surface snapshot with each request, and the server always trusts the client's version over its own cache. The server-side cache is eventually consistent, not authoritative.

### 3. Managing Workflow State
When a workflow is active, the session holds the full workflow state: which workflow, which step, what data has been collected so far. This ensures workflow continuity across turns and handles reconnects (if the user refreshes, the workflow resumes from the stored state).

### 4. Logging Tool Executions
Every tool call (name, timestamp, duration, success/failure) is logged per session. This powers the developer debug panel and is used for usage analytics in Phase 3.

### 5. Session Lifecycle
Sessions are created on the first message. They expire after a configurable idle timeout (default: 30 minutes). The SessionStore handles creation, reads, writes, and TTL-based expiration.

---

## What It Does NOT Do

- It does not call Claude or execute tools
- It is not the authoritative source of client-side UI state (that's the `StateStore`)
- It does not store user accounts or authentication — sessions are anonymous by default
- It does not persist to a database in MVP (in-memory only)

---

## Interface

```typescript
interface SessionStore {
  get(sessionId: string): Session | null;
  getOrCreate(sessionId: string): Session;
  update(sessionId: string, patch: Partial<Session>): void;
  appendMessage(sessionId: string, message: SessionMessage): void;
  setWorkflowState(sessionId: string, state: WorkflowState | null): void;
  logToolExecution(sessionId: string, log: ToolLog): void;
  delete(sessionId: string): void;
  list(): SessionSummary[]; // For admin/debug only
}

interface Session {
  id: string;
  createdAt: number;
  lastActiveAt: number;
  messages: SessionMessage[];
  surfaceSnapshot: SurfaceSnapshot;
  workflowState: WorkflowState | null;
  toolExecutionLog: ToolLog[];
  metadata: Record<string, unknown>; // Extensible: userId, appId, etc.
}

interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolUseIds?: string[]; // Links message to tool calls for traceability
}

interface WorkflowState {
  workflowId: string;
  stepId: string;
  stepIndex: number;
  totalSteps: number;
  collectedData: Record<string, unknown>;
  startedAt: number;
}

interface ToolLog {
  toolName: string;
  toolUseId: string;
  calledAt: number;
  durationMs: number;
  success: boolean;
  error?: string;
  inputSummary?: Record<string, unknown>; // Truncated, no secrets
}
```

---

## MVP Implementation (In-Memory)

For Phase 1, the SessionStore is a simple in-memory `Map` with TTL expiration. There is no persistence — sessions are lost on server restart, which is acceptable for development and demos.

```typescript
class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();
  private ttlMs: number;

  constructor(ttlMs = 30 * 60 * 1000) { // 30 minutes default
    this.ttlMs = ttlMs;
    // Prune expired sessions every 5 minutes
    setInterval(() => this.prune(), 5 * 60 * 1000);
  }

  getOrCreate(sessionId: string): Session {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        messages: [],
        surfaceSnapshot: defaultSnapshot(),
        workflowState: null,
        toolExecutionLog: [],
        metadata: {}
      });
    }
    const session = this.sessions.get(sessionId)!;
    session.lastActiveAt = Date.now();
    return session;
  }

  appendMessage(sessionId: string, message: SessionMessage): void {
    const session = this.getOrCreate(sessionId);
    session.messages.push(message);
  }

  setWorkflowState(sessionId: string, state: WorkflowState | null): void {
    const session = this.getOrCreate(sessionId);
    session.workflowState = state;
  }

  logToolExecution(sessionId: string, log: ToolLog): void {
    const session = this.getOrCreate(sessionId);
    session.toolExecutionLog.push(log);
    // Keep last 100 logs per session
    if (session.toolExecutionLog.length > 100) {
      session.toolExecutionLog = session.toolExecutionLog.slice(-100);
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastActiveAt > this.ttlMs) {
        this.sessions.delete(id);
      }
    }
  }
}
```

---

## Phase 2: Redis Implementation

For multi-server deployments, the SessionStore is backed by Redis. The interface is identical — only the implementation changes.

```typescript
class RedisSessionStore implements SessionStore {
  constructor(private redis: Redis, private ttlSeconds = 1800) {}

  async getOrCreate(sessionId: string): Promise<Session> {
    const existing = await this.redis.get(`session:${sessionId}`);
    if (existing) {
      const session = JSON.parse(existing) as Session;
      session.lastActiveAt = Date.now();
      await this.save(sessionId, session);
      return session;
    }
    const newSession: Session = { id: sessionId, createdAt: Date.now(), ... };
    await this.save(sessionId, newSession);
    return newSession;
  }

  private async save(sessionId: string, session: Session): Promise<void> {
    await this.redis.setex(
      `session:${sessionId}`,
      this.ttlSeconds,
      JSON.stringify(session)
    );
  }
}
```

Switching from in-memory to Redis requires only changing how the `SessionStore` is instantiated in `apps/api/src/index.ts`. All consuming code is unchanged.

---

## Surface Snapshot Sync

The server's surface snapshot is updated after each successful tool execution:

```typescript
// After ToolExecutor runs
if (toolResult.success) {
  const currentSnapshot = session.surfaceSnapshot;

  // Apply surface update to server-side snapshot
  if (update.op === "SET_VIEWPORT") {
    currentSnapshot.map.viewport = update.payload as Viewport;
  } else if (update.op === "ADD_MARKERS") {
    const markers = update.payload.markers as Marker[];
    markers.forEach((m) => {
      currentSnapshot.map.markers[m.id] = { id: m.id, label: m.label };
    });
    currentSnapshot.map.markerCount = Object.keys(currentSnapshot.map.markers).length;
  }

  sessionStore.update(sessionId, { surfaceSnapshot: currentSnapshot });
}
```

But on each new request, the client's snapshot takes precedence:

```typescript
// In the orchestration handler
const session = sessionStore.getOrCreate(request.sessionId);

// Always trust the client's surface state over the server's cached state
if (request.surfaceSnapshot) {
  session.surfaceSnapshot = request.surfaceSnapshot;
  sessionStore.update(request.sessionId, { surfaceSnapshot: request.surfaceSnapshot });
}
```

This makes the system self-healing. If the server-side snapshot drifts (e.g., due to a bug or a network hiccup dropping a response), the very next message from the client re-syncs it.

---

## What Gets Stored vs. What Gets Sent to Claude

Not everything in the session is sent to Claude on every request. The `ContextBuilder` reads from the session but is selective about what it includes in the prompt:

| Session Data | Sent to Claude? | Notes |
|---|---|---|
| `messages` (last 20) | Yes | Rolling window |
| `surfaceSnapshot` | Yes | Compact form only |
| `workflowState` | Yes | Full state when active |
| `toolExecutionLog` | No | For debugging only |
| `metadata` | No | Not part of context |
| Full marker metadata | No | Only ID + label in snapshot |
| Old messages (>20) | No | Outside window |

---

## Key Design Decisions

**Why does the client send the surface snapshot on every request instead of the server maintaining it authoritatively?**
The server can't know about every UI interaction — the user might manually pan the map, resize the panel, or interact with elements that don't produce API calls. The client is always the ground truth for UI state. Sending the snapshot with each request is a simple way to keep the server's context accurate without a persistent websocket or a separate sync endpoint.

**Why in-memory for MVP instead of starting with Redis?**
In-memory is zero infrastructure. You can start building immediately without running Redis, configuring connection strings, or handling Redis errors. The interface abstraction means the switch to Redis is a single-file change when you need it — typically when you deploy to multiple server instances or need persistence across restarts.

**Why keep the tool execution log per-session?**
Tool execution logs are diagnostically valuable: they show you exactly what Claude called, when, how long it took, and whether it succeeded. Per-session storage means you can retrieve the full call history for a specific user conversation when debugging, without needing a separate analytics system. In Phase 3, these logs also feed into usage monitoring and prompt quality analysis.

---

## Files

```
apps/api/src/session/store.ts          # SessionStore interface + InMemorySessionStore
apps/api/src/session/redisStore.ts     # RedisSessionStore (Phase 2)
apps/api/src/session/types.ts          # Session, SessionMessage, WorkflowState types
```
