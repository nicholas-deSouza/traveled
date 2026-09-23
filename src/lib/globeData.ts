import type { PhotoMetadata } from './groups';
import { hasLocation } from './photoMetadata';

type PointFeature = { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: PointProperties };
type PhotoCollection = { type: 'FeatureCollection'; features: PointFeature[] };

export type PointProperties = { count: number; representative: number };
// Preaggregate exact coordinates so coincident photos remain grouped at any zoom.
export function photoPoints(photos: PhotoMetadata[]): { photos: PhotoMetadata[]; data: PhotoCollection } {
  const sorted = photos.filter(hasLocation).sort((a, b) => a.id.localeCompare(b.id));
  const points = new Map<string, PhotoCollection['features'][number]>();
  sorted.forEach((photo, index) => {
    const key = `${photo.longitude},${photo.latitude}`;
    const existing = points.get(key);
    if (existing) existing.properties.count++;
    else points.set(key, { type: 'Feature', geometry: { type: 'Point', coordinates: [photo.longitude, photo.latitude] }, properties: { count: 1, representative: index } });
  });
  return { photos: sorted, data: { type: 'FeatureCollection', features: [...points.values()] } };
}

export function markerOffsets(points: { id: string; x: number; y: number }[]): Map<string, [number, number]> {
  const placed: { x: number; y: number }[] = [];
  const offsets = new Map<string, [number, number]>();
  for (const point of [...points].sort((a, b) => a.id.localeCompare(b.id))) {
    let dx = 0, dy = 0;
    for (let step = 0; placed.some(other => Math.abs(other.x - point.x - dx) < 76 && Math.abs(other.y - point.y - dy) < 76); step++) {
      const ring = Math.floor(step / 8) + 1;
      const angle = (step % 8) * Math.PI / 4;
      dx = Math.cos(angle) * ring * 88;
      dy = Math.sin(angle) * ring * 88;
    }
    placed.push({ x: point.x + dx, y: point.y + dy });
    offsets.set(point.id, [dx, dy]);
  }
  return offsets;
}
