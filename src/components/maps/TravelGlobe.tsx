import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import maplibregl from 'maplibre-gl';
import { downloadPhoto, type AtlasTrip, type PhotoMetadata } from '../../lib/groups';
import { tripColor } from '../../lib/tripColor';
import { markerOffsets, photoPoints } from '../../lib/globeData';
import { thumbnailCache } from '../../lib/thumbnailCache';
import { Button } from '../ui/button';

const mapStyle = import.meta.env.VITE_MAP_STYLE_URL?.trim() || 'https://tiles.openfreemap.org/styles/liberty';
const THUMBNAIL_ZOOM = 5;

type PhotoMarker = { marker: maplibregl.Marker; anchor: HTMLAnchorElement; image: HTMLImageElement; line: HTMLSpanElement; photo: PhotoMetadata };

async function downloadThumbnail(path: string) {
  const blob = await downloadPhoto(path);
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 160;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image preview unavailable.');
    const size = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 160, 160);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Image preview unavailable.')), 'image/jpeg', 0.8));
  } finally { bitmap.close(); }
}

export function TravelGlobe({ trips, photos }: { trips: AtlasTrip[]; photos: PhotoMetadata[] }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const styleReady = useRef(false);
  const [generation, setGeneration] = useState(0);
  const [ready, setReady] = useState(0);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (!container.current) return;
    styleReady.current = false;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({ container: container.current, style: mapStyle, center: [-20, 30], zoom: 1.15, maxZoom: 20 });
    } catch { setError('The globe could not start. Your trips are still available below.'); return; }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('style.load', () => { styleReady.current = true; map.setProjection({ type: 'globe' }); setReady(value => value + 1); setError(''); });
    map.on('error', () => setError('Some map content could not load. Your trips are still available below.'));
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(container.current);
    return () => { resize.disconnect(); mapRef.current = null; map.remove(); };
  }, [generation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    const markers = new Map<string, PhotoMarker>();
    const cache = thumbnailCache(downloadThumbnail);
    const grouped = new Map<string, PhotoMetadata[]>();
    photos.forEach(photo => { const group = grouped.get(photo.trip_id) ?? []; group.push(photo); grouped.set(photo.trip_id, group); });
    const sources = trips.filter(trip => grouped.has(trip.id)).map(trip => {
      const id = `photos-${trip.id}`;
      const points = photoPoints(grouped.get(trip.id)!);
      map.addSource(id, {
        type: 'geojson', data: points.data, cluster: true, clusterRadius: 80, clusterMaxZoom: 20,
        clusterProperties: { count: ['+', ['get', 'count']], representative: ['min', ['get', 'representative']] },
      });
      map.addLayer({ id, type: 'circle', source: id, paint: {
        'circle-radius': 6, 'circle-color': tripColor(trip), 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
        'circle-opacity': ['step', ['zoom'], 1, THUMBNAIL_ZOOM, 0],
        'circle-stroke-opacity': ['step', ['zoom'], 1, THUMBNAIL_ZOOM, 0],
      } });
      return { id, trip, photos: points.photos };
    });
    let frame = 0;
    function update() {
      frame = 0;
      const visible = new Set<string>();
      const positions: { id: string; x: number; y: number }[] = [];
      const downloads = new Map<string, (url: string | null) => void>();
      if (map!.getZoom() >= THUMBNAIL_ZOOM) {
        for (const source of sources) {
          for (const feature of map!.queryRenderedFeatures(undefined, { layers: [source.id] })) {
            if (feature.geometry.type !== 'Point') continue;
            const index = Number(feature.properties.representative);
            const photo = source.photos[index];
            if (!photo) continue;
            const key = `${source.id}:${feature.properties.cluster ? `cluster-${feature.properties.cluster_id}` : photo.id}`;
            if (visible.has(key)) continue;
            visible.add(key);
            const coordinates = feature.geometry.coordinates as [number, number];
            const projected = map!.project(coordinates);
            positions.push({ id: key, x: projected.x, y: projected.y });
            let entry = markers.get(key);
            if (!entry) {
              const root = document.createElement('div');
              root.className = 'atlas-marker';
              const line = document.createElement('span'); line.className = 'atlas-marker-line'; line.style.background = tripColor(source.trip);
              const anchor = document.createElement('a');
              anchor.className = 'atlas-photo'; anchor.href = `/trips/${source.trip.id}`; anchor.style.borderColor = tripColor(source.trip);
              const count = Number(feature.properties.count) || 1;
              anchor.setAttribute('aria-label', `${source.trip.title}: ${count} ${count === 1 ? 'photo' : 'photos'}. Open trip.`);
              anchor.title = `${source.trip.title} · ${count} photos`;
              anchor.addEventListener('click', event => {
                if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); navigate(`/trips/${source.trip.id}`); }
              });
              const fallback = document.createElement('span'); fallback.className = 'atlas-photo-fallback'; fallback.textContent = 'Photo';
              const image = document.createElement('img'); image.alt = ''; image.hidden = true;
              image.addEventListener('error', () => { image.hidden = true; fallback.textContent = 'Unavailable'; });
              anchor.append(fallback, image);
              if (count > 1) { const badge = document.createElement('span'); badge.className = 'atlas-photo-count'; badge.textContent = String(count); anchor.append(badge); }
              root.append(line, anchor);
              const marker = new maplibregl.Marker({ element: root, anchor: 'center' }).setLngLat(coordinates).addTo(map!);
              entry = { marker, anchor, image, line, photo }; markers.set(key, entry);
            }
            entry.marker.setLngLat(coordinates);
            const current = entry;
            downloads.set(photo.storage_path, url => {
              if (url) { if (current.image.getAttribute('src') !== url) current.image.src = url; current.image.hidden = false; }
              else { current.image.hidden = true; const fallback = current.anchor.querySelector('.atlas-photo-fallback'); if (fallback) fallback.textContent = 'Unavailable'; }
            });
          }
        }
      }
      for (const [key, entry] of markers) if (!visible.has(key)) { entry.marker.remove(); markers.delete(key); }
      const offsets = markerOffsets(positions);
      for (const [key, [x, y]] of offsets) {
        const entry = markers.get(key)!;
        entry.anchor.style.transform = `translate(${x}px, ${y}px)`;
        entry.line.style.width = `${Math.hypot(x, y)}px`;
        entry.line.style.transform = `rotate(${Math.atan2(y, x)}rad)`;
      }
      cache.setVisible(downloads);
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(update); }
    map.on('move', schedule); map.on('sourcedata', schedule); map.on('resize', schedule); map.on('idle', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame); cache.dispose(); markers.forEach(entry => entry.marker.remove());
      map.off('move', schedule); map.off('sourcedata', schedule); map.off('resize', schedule); map.off('idle', schedule);
      // The map creation effect can dispose the map before this effect's cleanup.
      if (mapRef.current === map) for (const source of sources) { if (map.getLayer(source.id)) map.removeLayer(source.id); if (map.getSource(source.id)) map.removeSource(source.id); }
    };
  }, [trips, photos, ready, generation, navigate]);

  return <section aria-label="Shared trip globe">
    <div ref={container} aria-label="Interactive globe with photos from your trips" className="h-[460px] w-full overflow-hidden rounded-3xl bg-ink md:h-[620px]" />
    {error && <div className="mt-3"><p role="alert" className="text-sm">{error}</p><Button className="mt-2" variant="outline" onClick={() => { setError(''); setGeneration(value => value + 1); }}>Retry globe</Button></div>}
  </section>;
}
