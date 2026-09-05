import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { demoTrips } from "../../types/domain";

// Liberty is an OSM vector style with administrative boundaries and place labels.
// A custom production style can replace it via VITE_MAP_STYLE_URL.
const mapStyle = import.meta.env.VITE_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty";

export function TravelGlobe() {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: mapStyle,
      center: [-20, 30],
      zoom: 1.15,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("style.load", () => {
      map.setProjection({ type: "globe" });
      map.addSource("trips", { type: "geojson", data: { type: "FeatureCollection", features: demoTrips.map((trip) => ({ type: "Feature", properties: { title: trip.title, photos: trip.photoCount }, geometry: { type: "Point", coordinates: [trip.longitude, trip.latitude] } })) } });
      map.addLayer({ id: "trip-rings", type: "circle", source: "trips", paint: { "circle-radius": 13, "circle-color": "#E06C47", "circle-opacity": 0.18 } });
      map.addLayer({ id: "trip-points", type: "circle", source: "trips", paint: { "circle-radius": 6, "circle-color": "#E06C47", "circle-stroke-width": 2, "circle-stroke-color": "#FFF" } });
      map.on("click", "trip-points", (event) => {
        const feature = event.features?.[0];
        if (!feature?.geometry || feature.geometry.type !== "Point") return;
        new maplibregl.Popup({ closeButton: false, offset: 12 }).setLngLat(feature.geometry.coordinates as [number, number]).setHTML(`<strong>${feature.properties?.title}</strong><br/>${feature.properties?.photos} photos`).addTo(map);
      });
      map.on("mouseenter", "trip-points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "trip-points", () => { map.getCanvas().style.cursor = ""; });
    });
    return () => map.remove();
  }, []);

  return <div ref={container} aria-label="Interactive globe with your trips" className="h-[460px] w-full overflow-hidden rounded-3xl bg-ink md:h-[620px]" />;
}
