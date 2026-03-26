import Anthropic from "@anthropic-ai/sdk";
import type { FastifyRequest, FastifyReply } from "fastify";
import type {
  AIResponse,
  SurfaceUpdate,
  ChatRequest,
  Marker,
  Viewport,
} from "@uiflow/types";
import type { InMemorySessionStore } from "../session/store.js";
import { config } from "../config.js";
import { MAP_TOOLS, processMapToolCall } from "../tools/map.tools.js";

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

function buildSystemPrompt(snapshotJson: string): string {
  return `You are UIFlow, an AI assistant that controls a Mapbox map interface and a dynamic side panel.

AVAILABLE MAP TOOLS:
- map_set_viewport: Pan and zoom the map to a specific location
- map_add_markers: Place one or more markers on the map
- map_remove_markers: Remove markers by ID
- map_fit_bounds: Fit the map viewport to show all current markers

RULES:
- When a user mentions a place, city, address, or region: ALWAYS call map_set_viewport
- When returning location results: ALWAYS call map_add_markers AND map_fit_bounds
- NEVER invent coordinates. If you only have a place name, describe the location clearly and use your best known coordinates for well-known places.
- Be concise in text responses. The map does the showing — your text confirms and explains.
- Never say you will do something and then not call the tool. Always follow through.

CURRENT MAP STATE:
${snapshotJson}`;
}

export async function chatHandler(
  request: FastifyRequest<{ Body: ChatRequest }>,
  reply: FastifyReply,
  sessionStore: InMemorySessionStore
): Promise<void> {
  const { sessionId, message, surfaceSnapshot } = request.body;

  // Sync client snapshot to session
  sessionStore.updateSnapshot(sessionId, surfaceSnapshot);
  const session = sessionStore.getOrCreate(sessionId);

  // Append user message
  sessionStore.appendMessage(sessionId, {
    role: "user",
    content: message,
    timestamp: Date.now(),
  });

  // Build Claude messages from history (rolling window of last 20)
  const history = session.messages.slice(-20);
  const claudeMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Call Claude
  const response = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    system: buildSystemPrompt(JSON.stringify(surfaceSnapshot, null, 2)),
    tools: MAP_TOOLS,
    messages: claudeMessages,
  });

  // Process response
  const surfaceUpdates: SurfaceUpdate[] = [];
  let textContent = "";

  for (const block of response.content) {
    if (block.type === "text") {
      textContent = block.text;
    } else if (block.type === "tool_use") {
      const update = processMapToolCall(
        block.name,
        block.input as Record<string, unknown>,
        sessionId,
        sessionStore
      );
      if (update) surfaceUpdates.push(update);
    }
  }

  // Append assistant message to session
  sessionStore.appendMessage(sessionId, {
    role: "assistant",
    content: textContent || "Done.",
    timestamp: Date.now(),
  });

  const aiResponse: AIResponse = {
    messageId: crypto.randomUUID(),
    content: textContent,
    surfaceUpdates,
    hasErrors: false,
    tokenUsage: {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };

  return reply.send(aiResponse);
}
