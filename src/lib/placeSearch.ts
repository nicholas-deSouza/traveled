import { hasLocation } from './photoMetadata';

export type Place = { id: string; name: string; latitude: number; longitude: number };
// Explicit searches only (no autocomplete). Deployments can switch providers
// to a compatible Nominatim endpoint without changing the picker.
const endpoint = import.meta.env.VITE_GEOCODER_URL?.trim() || 'https://nominatim.openstreetmap.org/search';
const cache = new Map<string, Place[]>();
let lastRequest = 0;

export async function searchPlaces(query: string, signal: AbortSignal): Promise<Place[]> {
  const text = query.trim();
  if (text.length < 2 || text.length > 200) throw new Error('Enter a place name between 2 and 200 characters.');
  const cached = cache.get(text.toLowerCase());
  if (cached) return cached;
  if (Date.now() - lastRequest < 1100) throw new Error('Please wait a moment before searching again.');
  lastRequest = Date.now();
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ q: text, format: 'jsonv2', limit: '5' }).toString();
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' }, credentials: 'omit' });
  if (!response.ok) throw new Error('Place search is unavailable. Try again or choose a point on the map.');
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error('Place search returned an invalid response. Try the map instead.');
  const places: Place[] = data.flatMap((row: unknown) => {
    if (!row || typeof row !== 'object' || !('lat' in row) || !('lon' in row) || !('display_name' in row)) return [];
    if (![row.lat, row.lon].every(value => typeof value === 'number' || (typeof value === 'string' && value.trim()))) return [];
    const coordinates = { latitude: Number(row.lat), longitude: Number(row.lon) };
    if (!hasLocation(coordinates) || typeof row.display_name !== 'string' || !row.display_name.trim()) return [];
    return [{ ...coordinates, id: `${coordinates.latitude},${coordinates.longitude}`, name: row.display_name }];
  });
  if (cache.size >= 100) cache.clear();
  cache.set(text.toLowerCase(), places);
  return places;
}
