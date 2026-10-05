import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';

export type PhotoLocation = { latitude: number; longitude: number };
const style = import.meta.env.VITE_MAP_STYLE_URL?.trim() || 'https://tiles.openfreemap.org/styles/liberty';

export function PhotoLocationMap({ location, onChange, disabled }: {
  location: PhotoLocation | null; onChange(location: PhotoLocation): void; disabled: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const callback = useRef(onChange);
  const locked = useRef(disabled);
  const [unavailable, setUnavailable] = useState(false);
  callback.current = onChange;
  locked.current = disabled;
  useEffect(() => {
    let map: maplibregl.Map | undefined;
    let marker: maplibregl.Marker | undefined;
    try {
      map = new maplibregl.Map({ container: container.current!, style, center: [0, 20], zoom: 1.2 });
      mapRef.current = map;
      marker = new maplibregl.Marker({ color: '#c65a3a', draggable: true });
      markerRef.current = marker;
      const choose = (latitude: number, longitude: number) => {
        if (locked.current) return;
        const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;
        callback.current({ latitude, longitude: wrapped });
      };
      map.on('click', event => choose(event.lngLat.lat, event.lngLat.lng));
      marker.on('dragend', () => { const point = marker!.getLngLat(); choose(point.lat, point.lng); });
      map.on('error', () => setUnavailable(true));
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    } catch { setUnavailable(true); }
    return () => { marker?.remove(); map?.remove(); mapRef.current = null; markerRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current, marker = markerRef.current;
    if (!map || !marker) return;
    marker.setDraggable(!disabled);
    if (location) {
      marker.setLngLat([location.longitude, location.latitude]).addTo(map);
      map.jumpTo({ center: [location.longitude, location.latitude], zoom: Math.max(10, map.getZoom()) });
    } else marker.remove();
  }, [location, disabled]);
  return <div>
    <p id="location-map-help" className="mb-2 text-sm text-ink/65">Click the map or drag the pin. You can also enter coordinates below.</p>
    <div ref={container} aria-label="Choose photo location on map" aria-describedby="location-map-help" className={`h-56 overflow-hidden rounded-xl bg-sand ${disabled ? 'pointer-events-none opacity-60' : ''}`} />
    {unavailable && <p role="status" className="mt-2 text-sm">The map is unavailable. Use place search or enter coordinates below.</p>}
  </div>;
}
