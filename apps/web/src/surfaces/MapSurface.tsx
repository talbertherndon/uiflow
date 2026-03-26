import { useEffect, useRef } from "react";
import Map, { Marker, Popup, useMap } from "react-map-gl";
import { useUIFlowStore } from "../store/index.js";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = import.meta.env["VITE_MAPBOX_TOKEN"] as string;

function MapController() {
  const { current: mapRef } = useMap();
  const viewport         = useUIFlowStore((s) => s.viewport);
  const fitBoundsSignal  = useUIFlowStore((s) => s.fitBoundsSignal);
  const fitBoundsPadding = useUIFlowStore((s) => s.fitBoundsPadding);
  const markers          = useUIFlowStore((s) => s.markers);
  const prevSignal       = useRef(0);

  useEffect(() => {
    if (!mapRef) return;
    mapRef.flyTo({ center: viewport.center, zoom: viewport.zoom, duration: 1400, essential: true });
  }, [viewport, mapRef]);

  useEffect(() => {
    if (!mapRef || fitBoundsSignal === 0 || fitBoundsSignal === prevSignal.current) return;
    prevSignal.current = fitBoundsSignal;

    const list = Object.values(markers);
    if (list.length === 0) return;

    if (list.length === 1) {
      mapRef.flyTo({ center: list[0]!.coordinates, zoom: 15, duration: 1200 });
      return;
    }

    const lngs = list.map((m) => m.coordinates[0]);
    const lats  = list.map((m) => m.coordinates[1]);
    mapRef.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: fitBoundsPadding, duration: 1200, maxZoom: 16 }
    );
  }, [fitBoundsSignal, markers, fitBoundsPadding, mapRef]);

  // Fly to selected marker
  const selectedMarkerId = useUIFlowStore((s) => s.selectedMarkerId);
  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    if (!mapRef || !selectedMarkerId || selectedMarkerId === prevSelected.current) return;
    prevSelected.current = selectedMarkerId;
    const marker = markers[selectedMarkerId];
    if (marker) {
      mapRef.flyTo({ center: marker.coordinates, zoom: 16, duration: 900, essential: true });
    }
  }, [selectedMarkerId, markers, mapRef]);

  return null;
}

export function MapSurface() {
  const markers          = useUIFlowStore((s) => s.markers);
  const viewport         = useUIFlowStore((s) => s.viewport);
  const selectedMarkerId = useUIFlowStore((s) => s.selectedMarkerId);
  const setSelectedMarker = useUIFlowStore((s) => s.setSelectedMarker);

  return (
    <Map
      id="main-map"
      initialViewState={{
        longitude: viewport.center[0],
        latitude:  viewport.center[1],
        zoom:      viewport.zoom,
      }}
      style={{ width: "100%", height: "100%" }}
      mapStyle="mapbox://styles/mapbox/dark-v11"
      mapboxAccessToken={MAPBOX_TOKEN}
    >
      <MapController />

      {Object.values(markers).map((marker) => {
        const isSelected = selectedMarkerId === marker.id;
        return (
          <Marker
            key={marker.id}
            longitude={marker.coordinates[0]}
            latitude={marker.coordinates[1]}
            anchor="bottom"
            onClick={() => setSelectedMarker(isSelected ? null : marker.id)}
          >
            {/* Custom marker pin */}
            <div
              className="transition-transform duration-200 cursor-pointer"
              style={{ transform: isSelected ? "scale(1.35)" : "scale(1)" }}
            >
              <div
                className="w-3 h-3 rounded-full border-2 border-white shadow-lg"
                style={{ background: isSelected ? "#60a5fa" : (marker.color ?? "#3b82f6") }}
              />
            </div>
          </Marker>
        );
      })}

      {/* Popup for selected marker */}
      {selectedMarkerId && markers[selectedMarkerId] && (
        <Popup
          longitude={markers[selectedMarkerId]!.coordinates[0]}
          latitude={markers[selectedMarkerId]!.coordinates[1]}
          anchor="bottom"
          offset={20}
          closeButton={false}
          closeOnClick={false}
          className="uiflow-popup"
        >
          <div className="bg-surface-900 border border-white/10 rounded-xl px-3 py-2 shadow-xl min-w-[140px]">
            <p className="text-xs font-semibold text-white leading-tight">
              {markers[selectedMarkerId]!.label}
            </p>
            {typeof markers[selectedMarkerId]!.metadata?.["address"] === "string" && (
              <p className="text-[10px] text-white/40 mt-0.5 leading-snug">
                {markers[selectedMarkerId]!.metadata!["address"] as string}
              </p>
            )}
          </div>
        </Popup>
      )}
    </Map>
  );
}
