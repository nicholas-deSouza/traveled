import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Button } from "../ui/button";
import { downloadPhoto, type Atlas } from '../../lib/groups';
import { markerOffsets, photoPoints } from '../../lib/globeData';
import { thumbnailCache } from '../../lib/thumbnailCache';
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
    const cache = thumbnailCache(downloadPhoto);
    const datasets = trips.map(trip => ({ trip, id: `trip-${trip.id}`, points: photoPoints(photos.filter(photo => photo.trip_id === trip.id)) }));
    const markers = new Map<string, { marker: maplibregl.Marker; link: HTMLAnchorElement; image: HTMLImageElement; line: HTMLSpanElement }>();
    const updateThumbnails = () => {
      if (!map.isStyleLoaded()) return;
      const visible = new Map<string, { coordinates: [number, number]; path: string; title: string; tripId: string; color: string; count: number; x: number; y: number }>();
      if (map.getZoom() >= 3) {
        for (const { trip, id, points } of datasets) {
          if (!map.getLayer(id)) continue;
          // Rendered features exclude the far side of the globe and offscreen tiles.
          for (const feature of map.queryRenderedFeatures({ layers: [id] })) {
            if (feature.geometry.type !== 'Point') continue;
            const photo = points.photos[Number(feature.properties.representative)];
            if (!photo) continue;
            const coordinates = feature.geometry.coordinates.slice(0, 2) as [number, number];
            const position = map.project(coordinates);
            const key = `${id}-${feature.properties.cluster ? `cluster-${feature.properties.cluster_id}` : photo.id}`;
            visible.set(key, { coordinates, path: photo.storage_path, title: trip.title, tripId: trip.id, color: tripColor(trip), count: Number(feature.properties.count), x: position.x, y: position.y });
          }
        }
      }
      for (const [key, entry] of markers) {
        if (!visible.has(key)) { entry.marker.remove(); markers.delete(key); }
      }
      const offsets = markerOffsets([...visible].map(([id, point]) => ({ id, x: point.x, y: point.y })));
      const wanted = new Map<string, (url: string | null) => void>();
      for (const [key, point] of visible) {
        let entry = markers.get(key);
        if (!entry) {
          const element = document.createElement('div');
          element.className = 'atlas-marker';
          const line = document.createElement('span');
          line.className = 'atlas-marker-line';
          line.style.backgroundColor = point.color;
          const link = document.createElement('a');
          link.className = 'atlas-photo';
          link.href = `/trips/${encodeURIComponent(point.tripId)}`;
          link.style.borderColor = point.color;
          link.setAttribute('aria-label', `${point.title}: ${point.count} photos. Open trip`);
          const fallback = document.createElement('span');
          fallback.className = 'atlas-photo-fallback';
          fallback.textContent = 'View trip';
          const image = document.createElement('img');
          image.alt = '';
          image.hidden = true;
          image.onerror = () => { image.hidden = true; };
          const count = document.createElement('span');
          count.className = 'atlas-photo-count';
          count.textContent = String(point.count);
          link.append(fallback, image, count);
          element.append(line, link);
          const marker = new maplibregl.Marker({ element, anchor: 'center' }).setLngLat(point.coordinates).addTo(map);
          entry = { marker, link, image, line };
          markers.set(key, entry);
        }
        entry.marker.setLngLat(point.coordinates);
        const [dx, dy] = offsets.get(key)!;
        entry.link.style.transform = `translate(${dx}px, ${dy}px)`;
        entry.line.style.width = `${Math.hypot(dx, dy)}px`;
        entry.line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        const image = entry.image;
        const previousReceiver = wanted.get(point.path);
        wanted.set(point.path, url => {
          previousReceiver?.(url);
          if (url && image.getAttribute('src') !== url) { image.hidden = false; image.src = url; }
          if (!url) { image.hidden = true; image.removeAttribute('src'); }
        });
      }
      cache.setVisible(wanted);
    };
    map.on('render', updateThumbnails);
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
      for (const { trip, id, points } of datasets) {
        map.addSource(id, { type: 'geojson', data: points.data, cluster: true, clusterRadius: 60, clusterMaxZoom: 14,
          clusterProperties: { count: ['+', ['get', 'count']], representative: ['min', ['get', 'representative']] },
        });
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
      map.off('render', updateThumbnails);
      markers.forEach(entry => entry.marker.remove());
      cache.dispose();
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
