import Anthropic from "@anthropic-ai/sdk";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { AIResponse, SurfaceUpdate, ChatRequest } from "@uiflow/types";
import type { InMemorySessionStore } from "../session/store.js";
import { config } from "../config.js";
import { MAP_TOOLS, processMapToolCall } from "../tools/map.tools.js";
import { SEARCH_TOOLS, searchPlaces, deriveSearchSurfaceUpdates } from "../tools/search.tools.js";

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const ALL_TOOLS = [...MAP_TOOLS, ...SEARCH_TOOLS];

function buildSystemPrompt(snapshotJson: string): string {
  return `You are UIFlow, an AI assistant that controls a Mapbox map interface and a dynamic side panel.

TOOLS AVAILABLE:
Map control:
- map_set_viewport   — pan/zoom the map to a location
- map_add_markers    — place markers on the map
- map_remove_markers — remove markers by ID (use ["*"] to clear all)
- map_fit_bounds     — fit the viewport to show all current markers

Search:
- search_places — find businesses, restaurants, parks, or any POI near a location
  → After calling search_places, do NOT also call map_add_markers or panel_render_cards.
  → The system handles rendering automatically from search results.

RULES:
- When the user mentions a place or city with no search intent: call map_set_viewport
- When the user wants to find/search for places: call search_places with the current map center as proximity
- NEVER invent coordinates. Use map_set_viewport to go to a city first, then search_places.
- Be concise. The map and panel do the showing — your text confirms what happened.
- If the user's intent is ambiguous between "go to" vs "find near", prefer search_places.

CURRENT MAP STATE:
${snapshotJson}`;
}

export async function chatHandler(
  request: FastifyRequest<{ Body: ChatRequest }>,
  reply: FastifyReply,
  sessionStore: InMemorySessionStore
): Promise<void> {
  const { sessionId, message, surfaceSnapshot } = request.body;

  sessionStore.updateSnapshot(sessionId, surfaceSnapshot);
  const session = sessionStore.getOrCreate(sessionId);

  sessionStore.appendMessage(sessionId, {
    role: "user",
    content: message,
    timestamp: Date.now(),
  });

  const history = session.messages.slice(-20);
  const claudeMessages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // ── First Claude call ──────────────────────────────────────────────────────
  const response = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1024,
    system: buildSystemPrompt(JSON.stringify(surfaceSnapshot, null, 2)),
    tools: ALL_TOOLS,
    messages: claudeMessages,
  });

  const surfaceUpdates: SurfaceUpdate[] = [];
  let textContent = "";
  const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

  for (const block of response.content) {
    if (block.type === "text") textContent = block.text;
    if (block.type === "tool_use") toolUseBlocks.push(block);
  }

  // ── Execute tool calls ─────────────────────────────────────────────────────
  const toolResults: Anthropic.ToolResultBlockParam[] = [];

  for (const tool of toolUseBlocks) {
    const input = tool.input as Record<string, unknown>;

    if (tool.name === "search_places") {
      try {
        const places = await searchPlaces(
          input["category"] as string,
          input["proximity"] as { lat: number; lng: number },
          (input["radiusMeters"] as number | undefined) ?? 1500,
          (input["limit"] as number | undefined) ?? 8
        );

        // Derive and collect surface updates
        const derived = deriveSearchSurfaceUpdates(places);
        surfaceUpdates.push(...derived);

        // Update session marker snapshot
        const sess = sessionStore.getOrCreate(sessionId);
        sess.surfaceSnapshot.map.markers = places.map((p) => ({ id: p.id, label: p.name }));
        sess.surfaceSnapshot.map.markerCount = places.length;

        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: JSON.stringify({ count: places.length, places }),
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: tool.id,
          content: `Error: ${err instanceof Error ? err.message : "search failed"}`,
          is_error: true,
        });
      }
    } else {
      // Map control tools
      const update = processMapToolCall(tool.name, input, sessionId, sessionStore);
      if (update) surfaceUpdates.push(update);

      toolResults.push({
        type: "tool_result",
        tool_use_id: tool.id,
        content: JSON.stringify({ success: true }),
      });
    }
  }

  // ── If tools were called, get Claude's final text response ─────────────────
  if (toolUseBlocks.length > 0 && response.stop_reason === "tool_use") {
    const followUp = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 512,
      system: buildSystemPrompt(JSON.stringify(surfaceSnapshot, null, 2)),
      tools: ALL_TOOLS,
      messages: [
        ...claudeMessages,
        { role: "assistant", content: response.content },
        { role: "user",      content: toolResults },
      ],
    });

    for (const block of followUp.content) {
      if (block.type === "text") textContent = block.text;
    }
  }

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
      input:  response.usage.input_tokens,
      output: response.usage.output_tokens,
    },
  };

  return reply.send(aiResponse);
}
