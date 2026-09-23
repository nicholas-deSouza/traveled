import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Button } from "../ui/button";
import { demoTrips } from "../../types/domain";

// Liberty is an OSM vector style with administrative boundaries and place labels.
// A custom production style can replace it via VITE_MAP_STYLE_URL.
const mapStyle = import.meta.env.VITE_MAP_STYLE_URL?.trim() || "https://tiles.openfreemap.org/styles/liberty";

export function TravelGlobe() {
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pausedRef = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleReady = useRef(false);
  const [generation, setGeneration] = useState(0);
  const [ready, setReady] = useState(0);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: mapStyle,
      center: [-20, 30],
      zoom: 1.15,
      attributionControl: false,
    });
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preferenceChanged = () => setReducedMotion(media.matches);
    media.addEventListener('change', preferenceChanged);
    let frame = 0;
    let previous = 0;
    let resumeAt = 0;
    let interacting = false;
    const delayRotation = () => { resumeAt = performance.now() + 5000; };
    const startInteraction = () => { interacting = true; delayRotation(); };
    const endInteraction = () => {
      if (!interacting) return;
      interacting = false;
      delayRotation();
    };
    // A release outside the browser may never produce pointerup in this window.
    const recoverInteraction = (event: PointerEvent) => {
      if (event.buttons === 0) endInteraction();
    };
    const visibilityChanged = () => { endInteraction(); previous = 0; delayRotation(); };
    const element = container.current;
    element.addEventListener('pointerdown', startInteraction);
    window.addEventListener('pointerup', endInteraction, true);
    window.addEventListener('pointercancel', endInteraction, true);
    window.addEventListener('pointermove', recoverInteraction, true);
    window.addEventListener('blur', endInteraction);
    element.addEventListener('lostpointercapture', endInteraction);
    element.addEventListener('click', endInteraction);
    element.addEventListener('wheel', delayRotation, { passive: true });
    element.addEventListener('keydown', delayRotation);
    document.addEventListener('visibilitychange', visibilityChanged);
    const rotate = (now: number) => {
      const elapsed = previous ? (now - previous) / 1000 : 0;
      previous = now;
      if (map.isStyleLoaded() && !document.hidden && !media.matches && !pausedRef.current && !interacting && now >= resumeAt && !map.isMoving()) {
        const center = map.getCenter();
        map.jumpTo({ center: [center.lng + elapsed * 2, center.lat] });
      }
      frame = requestAnimationFrame(rotate);
    };
    frame = requestAnimationFrame(rotate);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("style.load", () => {
      map.setProjection({ type: "globe" });
      map.addSource("trips", { type: "geojson", data: { type: "FeatureCollection", features: demoTrips.map((trip) => ({ type: "Feature", properties: { title: trip.title, photos: trip.photoCount }, geometry: { type: "Point", coordinates: [trip.longitude, trip.latitude] } })) } });
      map.addLayer({ id: "trip-rings", type: "circle", source: "trips", paint: { "circle-radius": 13, "circle-color": "#E06C47", "circle-opacity": 0.18 } });
      map.addLayer({ id: "trip-points", type: "circle", source: "trips", paint: { "circle-radius": 6, "circle-color": "#E06C47", "circle-stroke-width": 2, "circle-stroke-color": "#FFF" } });
      map.on("click", "trip-points", (event) => {
        const feature = event.features?.[0];
        if (!feature?.geometry || feature.geometry.type !== "Point") return;
        new maplibregl.Popup({ closeButton: false, offset: 12 }).setLngLat(feature.geometry.coordinates as [number, number]).setHTML(`<strong>Sample trip: ${feature.properties?.title}</strong><br/>${feature.properties?.photos} sample photos`).addTo(map);
      });
      map.addLayer({ id, type: 'circle', source: id, paint: {
        'circle-radius': 6, 'circle-color': tripColor(trip), 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
        'circle-opacity': ['step', ['zoom'], 1, THUMBNAIL_ZOOM, 0],
        'circle-stroke-opacity': ['step', ['zoom'], 1, THUMBNAIL_ZOOM, 0],
      } });
      return { id, trip, photos: points.photos };
    });
    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener('change', preferenceChanged);
      element.removeEventListener('pointerdown', startInteraction);
      window.removeEventListener('pointerup', endInteraction, true);
      window.removeEventListener('pointercancel', endInteraction, true);
      window.removeEventListener('pointermove', recoverInteraction, true);
      window.removeEventListener('blur', endInteraction);
      element.removeEventListener('lostpointercapture', endInteraction);
      element.removeEventListener('click', endInteraction);
      element.removeEventListener('wheel', delayRotation);
      element.removeEventListener('keydown', delayRotation);
      document.removeEventListener('visibilitychange', visibilityChanged);
      map.remove();
    };
  }, []);

  return <div className="relative">
    <div ref={container} aria-label="Interactive globe with sample trips" className="h-[460px] w-full overflow-hidden rounded-3xl bg-ink md:h-[620px]" />
    <div className="absolute left-3 top-3 rounded-xl bg-white/95 p-2">
      <Button size="sm" variant="outline" disabled={reducedMotion} aria-pressed={paused || reducedMotion} onClick={() => {
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
      }}>{paused || reducedMotion ? 'Resume rotation' : 'Pause rotation'}</Button>
      {reducedMotion && <p className="mt-1 text-xs text-ink/70">Rotation off for reduced motion.</p>}
    </div>
  </div>;
}
