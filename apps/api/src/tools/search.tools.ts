import Anthropic from "@anthropic-ai/sdk";
import type { SurfaceUpdate, CardDefinition, Marker } from "@uiflow/types";

export const SEARCH_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_places",
    description: `Search for places, businesses, or points of interest near a location.
Use when the user asks to find restaurants, coffee shops, hotels, parks, museums, stores, bars, gyms, or any type of place.
Returns real places with coordinates, name, address, and category.
After calling this tool the system automatically shows markers on the map and cards in the results panel — do NOT also call map_add_markers or panel_render_cards.`,
    input_schema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: `OpenStreetMap amenity/leisure/shop tag. Common values:
  Food & drink: cafe, restaurant, bar, fast_food, bakery, pub
  Services:      pharmacy, bank, hospital, clinic, post_office
  Leisure:       park, gym, cinema, theatre, museum, library
  Shopping:      supermarket, convenience, clothes, bookshop`,
        },
        proximity: {
          type: "object",
          description: "Center point to search near (use current map center if not specified)",
          properties: {
            lat: { type: "number" },
            lng: { type: "number" },
          },
          required: ["lat", "lng"],
        },
        radiusMeters: {
          type: "number",
          description: "Search radius in meters. Default: 1500. Max: 5000.",
        },
        limit: {
          type: "number",
          description: "Max results. Default: 8. Max: 15.",
        },
      },
      required: ["category", "proximity"],
    },
  },
];

export interface PlaceResult {
  id: string;
  name: string;
  address: string;
  category: string;
  coordinates: [number, number]; // [lng, lat]
}

// OSM tag → which key to query
const TAG_MAP: Record<string, { key: string; value: string }> = {
  // amenity
  cafe: { key: "amenity", value: "cafe" },
  restaurant: { key: "amenity", value: "restaurant" },
  bar: { key: "amenity", value: "bar" },
  pub: { key: "amenity", value: "pub" },
  fast_food: { key: "amenity", value: "fast_food" },
  bakery: { key: "amenity", value: "bakery" },
  pharmacy: { key: "amenity", value: "pharmacy" },
  bank: { key: "amenity", value: "bank" },
  hospital: { key: "amenity", value: "hospital" },
  clinic: { key: "amenity", value: "clinic" },
  post_office: { key: "amenity", value: "post_office" },
  museum: { key: "amenity", value: "museum" },
  library: { key: "amenity", value: "library" },
  cinema: { key: "amenity", value: "cinema" },
  theatre: { key: "amenity", value: "theatre" },
  gym: { key: "leisure", value: "fitness_centre" },
  park: { key: "leisure", value: "park" },
  supermarket: { key: "shop", value: "supermarket" },
  convenience: { key: "shop", value: "convenience" },
  clothes: { key: "shop", value: "clothes" },
  bookshop: { key: "shop", value: "books" },
};

export async function searchPlaces(
  category: string,
  proximity: { lat: number; lng: number },
  radiusMeters = 1500,
  limit = 8
): Promise<PlaceResult[]> {
  const radius = Math.min(radiusMeters, 5000);
  const cap    = Math.min(limit, 15);
  const tag    = TAG_MAP[category] ?? { key: "amenity", value: category };

  const query = `[out:json][timeout:15];
node["${tag.key}"="${tag.value}"](around:${radius},${proximity.lat},${proximity.lng});
out ${cap};`;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);

  const data = await res.json() as OverpassResponse;

  return data.elements
    .filter((el) => el.tags?.["name"]) // skip unnamed places
    .map((el) => {
      const tags    = el.tags!;
      const street  = tags["addr:street"] ?? "";
      const city    = tags["addr:city"] ?? "";
      const address = [street, city].filter(Boolean).join(", ") || "Address unavailable";

      return {
        id:          `osm-${el.id}`,
        name:        tags["name"]!,
        address,
        category:    tags[tag.key] ?? category,
        coordinates: [el.lon, el.lat] as [number, number],
      };
    });
}

// Derive surface updates from search results
export function deriveSearchSurfaceUpdates(places: PlaceResult[]): SurfaceUpdate[] {
  if (places.length === 0) return [];

  const markers: Marker[] = places.map((p) => ({
    id:          p.id,
    coordinates: p.coordinates,
    label:       p.name,
    color:       "#3b82f6",
    metadata:    { address: p.address, category: p.category },
  }));

  const cards: CardDefinition[] = places.map((p) => ({
    id:       p.id,
    title:    p.name,
    subtitle: p.category,
    body:     p.address,
    markerId: p.id,
  }));

  return [
    { surface: "map",   op: "REMOVE_MARKERS", payload: { ids: ["*"] } },
    { surface: "map",   op: "ADD_MARKERS",    payload: { markers } },
    { surface: "map",   op: "FIT_BOUNDS",     payload: { padding: 80 } },
    { surface: "panel", op: "RENDER_CARDS",   payload: { cards } },
  ];
}

// ─── Overpass API types ───────────────────────────────────────────────────────

interface OverpassResponse {
  elements: OverpassElement[];
}

interface OverpassElement {
  id:   number;
  lat:  number;
  lon:  number;
  tags?: Record<string, string>;
}
