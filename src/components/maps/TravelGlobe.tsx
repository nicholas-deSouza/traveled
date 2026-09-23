import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Button } from "../ui/button";
import type { Atlas } from '../../lib/groups';
import { photoPoints } from '../../lib/globeData';
import { tripColor } from '../../lib/tripColor';

// Liberty is an OSM vector style with administrative boundaries and place labels.
// A custom production style can replace it via VITE_MAP_STYLE_URL.
const mapStyle = import.meta.env.VITE_MAP_STYLE_URL?.trim() || "https://tiles.openfreemap.org/styles/liberty";

export function TravelGlobe({ trips, photos }: Atlas) {
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pausedRef = useRef(false);
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
      for (const trip of trips) {
        const id = `trip-${trip.id}`;
        const points = photoPoints(photos.filter(photo => photo.trip_id === trip.id));
        map.addSource(id, { type: 'geojson', data: points.data });
        map.addLayer({ id, type: 'circle', source: id, paint: {
          'circle-radius': 7, 'circle-color': tripColor(trip),
          'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
        } });
        map.on('click', id, event => {
          const feature = event.features?.[0];
          if (feature?.geometry.type !== 'Point') return;
          const content = document.createElement('div');
          const link = document.createElement('a');
          link.href = `/trips/${encodeURIComponent(trip.id)}`;
          link.textContent = trip.title;
          link.className = 'font-medium underline';
          const count = document.createElement('p');
          count.textContent = `${feature.properties?.count ?? 1} photos at this location`;
          content.append(link, count);
          new maplibregl.Popup({ offset: 12 })
            .setLngLat(feature.geometry.coordinates as [number, number])
            .setDOMContent(content).addTo(map);
        });
      }
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
  }, [trips, photos]);

  return <div className="relative">
    <div ref={container} aria-label="Interactive globe with trip photo locations" className="h-[460px] w-full overflow-hidden rounded-3xl bg-ink md:h-[620px]" />
    <div className="absolute left-3 top-3 rounded-xl bg-white/95 p-2">
      <Button size="sm" variant="outline" disabled={reducedMotion} aria-pressed={paused || reducedMotion} onClick={() => {
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
      }}>{paused || reducedMotion ? 'Resume rotation' : 'Pause rotation'}</Button>
      {reducedMotion && <p className="mt-1 text-xs text-ink/70">Rotation off for reduced motion.</p>}
    </div>
  </div>;
}
