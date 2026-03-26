import type { AIResponse, Message } from "@uiflow/types";
import { useUIFlowStore } from "../store/index.js";

const API_URL = import.meta.env["VITE_API_URL"] ?? "";

export async function sendMessage(content: string): Promise<void> {
  const store = useUIFlowStore.getState();

  const userMessage: Message = {
    id: crypto.randomUUID(),
    role: "user",
    content,
    timestamp: Date.now(),
  };

  store.addMessage(userMessage);
  store.setLoading(true);
  store.setError(null);

  try {
    const response = await fetch(`${API_URL}/api/chat/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: store.sessionId,
        message: content,
        surfaceSnapshot: store.getSurfaceSnapshot(),
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`API error ${response.status}: ${text}`);
    }

    const aiResponse: AIResponse = await response.json() as AIResponse;

    // Apply surface updates first so map moves before message appears
    aiResponse.surfaceUpdates.forEach((update) => {
      store.applySurfaceUpdate(update);
    });

    const assistantMessage: Message = {
      id: aiResponse.messageId,
      role: "assistant",
      content: aiResponse.content,
      timestamp: Date.now(),
      surfaceUpdates: aiResponse.surfaceUpdates,
    };

    store.addMessage(assistantMessage);
  } catch (err) {
    store.setError(err instanceof Error ? err.message : "Something went wrong");
  } finally {
    store.setLoading(false);
  }
}
