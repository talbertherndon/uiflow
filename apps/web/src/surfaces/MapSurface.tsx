import { useEffect, useRef } from "react";
import Map, { Marker, useMap } from "react-map-gl";
import { useUIFlowStore } from "../store/index.js";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = import.meta.env["VITE_MAPBOX_TOKEN"] as string;

function MapController() {
  const { current: mapRef } = useMap();
  const viewport        = useUIFlowStore((s) => s.viewport);
  const fitBoundsSignal = useUIFlowStore((s) => s.fitBoundsSignal);
  const fitBoundsPadding = useUIFlowStore((s) => s.fitBoundsPadding);
  const markers         = useUIFlowStore((s) => s.markers);
  const prevSignal      = useRef(0);

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
      const m = list[0]!;
      mapRef.flyTo({ center: m.coordinates, zoom: 15, duration: 1200 });
      return;
    }

    const lngs = list.map((m) => m.coordinates[0]);
    const lats  = list.map((m) => m.coordinates[1]);
    mapRef.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: fitBoundsPadding, duration: 1200, maxZoom: 16 }
    );
  }, [fitBoundsSignal, markers, fitBoundsPadding, mapRef]);

  return null;
}

export function MapSurface() {
  const markers  = useUIFlowStore((s) => s.markers);
  const viewport = useUIFlowStore((s) => s.viewport);

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
      {Object.values(markers).map((marker) => (
        <Marker
          key={marker.id}
          longitude={marker.coordinates[0]}
          latitude={marker.coordinates[1]}
          color={marker.color ?? "#3b82f6"}
          anchor="bottom"
        />
      ))}
    </Map>
  );
}
