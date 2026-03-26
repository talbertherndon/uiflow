import Anthropic from "@anthropic-ai/sdk";
import type { SurfaceUpdate, Marker, Viewport } from "@uiflow/types";
import type { InMemorySessionStore } from "../session/store.js";

export const MAP_TOOLS: Anthropic.Tool[] = [
  {
    name: "map_set_viewport",
    description:
      "Pan and zoom the map to a specific location. Use when the user mentions a place, city, address, or region.",
    input_schema: {
      type: "object",
      properties: {
        center: {
          type: "array",
          items: { type: "number" },
          description: "Coordinates as [longitude, latitude]",
        },
        zoom: {
          type: "number",
          description:
            "Zoom level 0-22. Countries: 4-6. Cities: 10-12. Streets: 14-16. Buildings: 17+",
        },
        label: {
          type: "string",
          description: "Human-readable name of the location",
        },
      },
      required: ["center", "zoom"],
    },
  },
  {
    name: "map_add_markers",
    description:
      "Add one or more markers to the map. Use when displaying search results, points of interest, or specific locations.",
    input_schema: {
      type: "object",
      properties: {
        markers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              coordinates: {
                type: "array",
                items: { type: "number" },
                description: "[longitude, latitude]",
              },
              label: { type: "string" },
              color: {
                type: "string",
                description: "Hex color e.g. #3B82F6",
              },
              metadata: { type: "object" },
            },
            required: ["id", "coordinates", "label"],
          },
        },
      },
      required: ["markers"],
    },
  },
  {
    name: "map_remove_markers",
    description: "Remove markers from the map by their IDs.",
    input_schema: {
      type: "object",
      properties: {
        ids: {
          type: "array",
          items: { type: "string" },
          description: "Array of marker IDs to remove. Use ['*'] to remove all.",
        },
      },
      required: ["ids"],
    },
  },
  {
    name: "map_fit_bounds",
    description:
      "Fit the map viewport to contain all current markers. Always call this after map_add_markers when showing multiple results.",
    input_schema: {
      type: "object",
      properties: {
        padding: {
          type: "number",
          description: "Padding in pixels around the bounds. Default: 60",
        },
      },
    },
  },
];

export function processMapToolCall(
  toolName: string,
  input: Record<string, unknown>,
  sessionId: string,
  sessionStore: InMemorySessionStore
): SurfaceUpdate | null {
  switch (toolName) {
    case "map_set_viewport": {
      const viewport: Viewport = {
        center: input["center"] as [number, number],
        zoom: input["zoom"] as number,
      };
      sessionStore.updateViewport(sessionId, viewport);
      return { surface: "map", op: "SET_VIEWPORT", payload: viewport as unknown as Record<string, unknown> };
    }

    case "map_add_markers": {
      const markers = input["markers"] as Marker[];
      const session = sessionStore.getOrCreate(sessionId);
      // Update session snapshot
      const existingIds = new Set(session.surfaceSnapshot.map.markers.map((m) => m.id));
      markers.forEach((m) => {
        if (!existingIds.has(m.id)) {
          session.surfaceSnapshot.map.markers.push({ id: m.id, label: m.label });
        }
      });
      session.surfaceSnapshot.map.markerCount = session.surfaceSnapshot.map.markers.length;
      return { surface: "map", op: "ADD_MARKERS", payload: { markers } };
    }

    case "map_remove_markers": {
      const ids = input["ids"] as string[];
      const session = sessionStore.getOrCreate(sessionId);
      if (ids.includes("*")) {
        session.surfaceSnapshot.map.markers = [];
        session.surfaceSnapshot.map.markerCount = 0;
      } else {
        session.surfaceSnapshot.map.markers = session.surfaceSnapshot.map.markers.filter(
          (m) => !ids.includes(m.id)
        );
        session.surfaceSnapshot.map.markerCount = session.surfaceSnapshot.map.markers.length;
      }
      return { surface: "map", op: "REMOVE_MARKERS", payload: { ids } };
    }

    case "map_fit_bounds": {
      return {
        surface: "map",
        op: "FIT_BOUNDS",
        payload: { padding: (input["padding"] as number) ?? 60 },
      };
    }

    default:
      return null;
  }
}
