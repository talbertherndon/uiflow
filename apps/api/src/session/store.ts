import type { SurfaceSnapshot, Viewport } from "@uiflow/types";

export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface Session {
  id: string;
  createdAt: number;
  lastActiveAt: number;
  messages: SessionMessage[];
  surfaceSnapshot: SurfaceSnapshot;
}

function defaultSnapshot(): SurfaceSnapshot {
  return {
    map: {
      viewport: { center: [-98.5795, 39.8283], zoom: 4 },
      markerCount: 0,
      markers: [],
      activeLayers: [],
      drawingActive: false,
    },
    panel: {
      contentType: "empty",
      itemCount: 0,
      activeWorkflowStep: null,
    },
  };
}

export class InMemorySessionStore {
  private sessions = new Map<string, Session>();
  private ttlMs: number;

  constructor(ttlMs = 30 * 60 * 1000) {
    this.ttlMs = ttlMs;
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

  updateSnapshot(sessionId: string, snapshot: SurfaceSnapshot): void {
    const session = this.getOrCreate(sessionId);
    session.surfaceSnapshot = snapshot;
  }

  updateViewport(sessionId: string, viewport: Viewport): void {
    const session = this.getOrCreate(sessionId);
    session.surfaceSnapshot.map.viewport = viewport;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
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
