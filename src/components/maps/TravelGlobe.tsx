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

type Thumbnail = { id: string; path: string; title: string; tripId: string; color: string; count: number; x: number; y: number; dx: number; dy: number; url: string | null };
type Popup = { title: string; tripId: string; count: number; coordinates: [number, number]; x: number; y: number };

function PhotoMarker({ point }: { point: Thumbnail }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return <div className="atlas-marker absolute" style={{ left: point.x, top: point.y }}>
    <span className="atlas-marker-line" style={{ backgroundColor: point.color, width: Math.hypot(point.dx, point.dy), transform: `rotate(${Math.atan2(point.dy, point.dx)}rad)` }} />
    <a className="atlas-photo pointer-events-auto" href={`/trips/${encodeURIComponent(point.tripId)}`} style={{ borderColor: point.color, transform: `translate(${point.dx}px, ${point.dy}px)` }} aria-label={`${point.title}: ${point.count} photos. Open trip`}>
      <span className="atlas-photo-fallback">View trip</span>
      {point.url && failedUrl !== point.url && <img src={point.url} alt="" onError={() => setFailedUrl(point.url)} />}
      <span className="atlas-photo-count">{point.count}</span>
    </a>
  </div>;
}

function TripLocationPopup({ popup, onClose }: { popup: Popup; onClose: () => void }) {
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => { link.current?.focus(); }, []);
  return <div role="dialog" aria-label="Trip location" onKeyDown={event => { if (event.key === 'Escape') onClose(); }} className="pointer-events-auto absolute z-10 w-56 rounded-xl bg-white p-3 shadow-lg" style={{ left: `clamp(7.5rem, ${popup.x}px, calc(100% - 7.5rem))`, top: `max(8rem, ${popup.y}px)`, transform: 'translate(-50%, calc(-100% - 12px))' }}>
    <a ref={link} className="font-medium underline" href={`/trips/${encodeURIComponent(popup.tripId)}`}>{popup.title}</a>
    <p>{popup.count} photos at this location</p>
    <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
  </div>;
}

export function TravelGlobe({ trips, photos }: Atlas) {
  const [thumbnails, setThumbnails] = useState<Thumbnail[]>([]);
  const [popup, setPopup] = useState<Popup | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const pausedRef = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const interactionRoot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const pageDocument = container.current.ownerDocument;
    const map = new maplibregl.Map({
      container: container.current,
      style: mapStyle,
      center: [-20, 30],
      zoom: 1.15,
      attributionControl: false,
    });
    const cache = thumbnailCache(downloadPhoto);
    const datasets = trips.map(trip => ({ trip, id: `trip-${trip.id}`, points: photoPoints(photos.filter(photo => photo.trip_id === trip.id)) }));
    const urls = new Map<string, string | null>();
    let currentThumbnails: Thumbnail[] = [];
    const publishThumbnails = () => setThumbnails(previous => {
      const next = currentThumbnails.map(point => ({ ...point, url: urls.get(point.path) ?? null }));
      return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
    });
    setThumbnails([]);
    setPopup(null);
    popupRef.current = null;
    const updateThumbnails = () => {
      if (!map.isStyleLoaded()) return;
      const visible = new Map<string, { coordinates: [number, number]; path: string; title: string; tripId: string; color: string; count: number; x: number; y: number }>();
      if (map.getZoom() >= 5) {
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
      const offsets = markerOffsets([...visible].map(([id, point]) => ({ id, x: point.x, y: point.y })));
      currentThumbnails = [...visible].map(([id, point]) => {
        const [dx, dy] = offsets.get(id)!;
        return { ...point, id, dx, dy, url: urls.get(point.path) ?? null };
      });
      const wanted = new Map<string, (url: string | null) => void>();
      for (const point of currentThumbnails) {
        wanted.set(point.path, url => {
          if (urls.get(point.path) === url) return;
          urls.set(point.path, url);
          publishThumbnails();
        });
      }
      for (const path of urls.keys()) if (!wanted.has(path)) urls.delete(path);
      publishThumbnails();
      if (popupRef.current) {
        const point = map.project(popupRef.current.coordinates);
        setPopup(previous => previous && (previous.x !== point.x || previous.y !== point.y) ? { ...previous, x: point.x, y: point.y } : previous);
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
    const windowFocused = () => { endInteraction(); previous = 0; delayRotation(); };
    const element = interactionRoot.current!;
    element.addEventListener('pointerdown', startInteraction);
    window.addEventListener('pointerup', endInteraction, true);
    window.addEventListener('pointercancel', endInteraction, true);
    window.addEventListener('pointermove', recoverInteraction, true);
    window.addEventListener('blur', endInteraction);
    element.addEventListener('lostpointercapture', endInteraction);
    element.addEventListener('click', endInteraction);
    element.addEventListener('wheel', delayRotation, { passive: true });
    element.addEventListener('keydown', delayRotation);
    window.addEventListener('focus', windowFocused);
    pageDocument.addEventListener('visibilitychange', windowFocused);
    const rotate = (now: number) => {
      const elapsed = previous ? Math.min((now - previous) / 1000, 0.25) : 0;
      previous = now;
      if (!pageDocument.hidden && map.isStyleLoaded() && !media.matches && !pausedRef.current && !interacting && now >= resumeAt && !map.isMoving()) {
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
        map.addSource(id, { type: 'geojson', data: points.data, cluster: true, clusterRadius: 80, clusterMaxZoom: 14,
          clusterProperties: { count: ['+', ['get', 'count']], representative: ['min', ['get', 'representative']] },
        });
        map.addLayer({ id, type: 'circle', source: id, paint: {
          'circle-radius': 7, 'circle-color': tripColor(trip),
          'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
        } });
        map.on('click', id, event => {
          const feature = event.features?.[0];
          if (feature?.geometry.type !== 'Point') return;
          const coordinates = feature.geometry.coordinates.slice(0, 2) as [number, number];
          const point = map.project(coordinates);
          const selected = { title: trip.title, tripId: trip.id, count: Number(feature.properties?.count ?? 1), coordinates, x: point.x, y: point.y };
          popupRef.current = selected;
          setPopup(selected);
        });
      }
    });
    return () => {
      map.off('render', updateThumbnails);
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
      window.removeEventListener('focus', windowFocused);
      pageDocument.removeEventListener('visibilitychange', windowFocused);
      map.remove();
    };
  }, [trips, photos]);

  const closePopup = () => { popupRef.current = null; setPopup(null); container.current?.focus(); };
  return <div ref={interactionRoot} className="relative">
    <div ref={container} tabIndex={-1} aria-label="Interactive globe with trip photo locations" className="h-[460px] w-full overflow-hidden rounded-3xl bg-ink md:h-[620px]" />
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
      {thumbnails.map(point => <PhotoMarker key={point.id} point={point} />)}
      {popup && <TripLocationPopup key={`${popup.tripId}-${popup.coordinates.join(',')}`} popup={popup} onClose={closePopup} />}
    </div>
    <div className="absolute left-3 top-3 rounded-xl bg-white/95 p-2">
      <Button size="sm" variant="outline" disabled={reducedMotion} aria-pressed={paused || reducedMotion} onClick={() => {
        pausedRef.current = !pausedRef.current;
        setPaused(pausedRef.current);
      }}>{paused || reducedMotion ? 'Resume rotation' : 'Pause rotation'}</Button>
      {reducedMotion && <p className="mt-1 text-xs text-ink/70">Rotation off for reduced motion.</p>}
    </div>
  </div>;
}
