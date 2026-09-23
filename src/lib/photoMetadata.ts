import { gps } from 'exifr';

export type Coordinates = { latitude: number | null; longitude: number | null };
export function hasLocation<T extends Coordinates>(value: T): value is T & { latitude: number; longitude: number } {
  return typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
    && typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}
export async function extractLocation(file: File): Promise<Coordinates> {
  try {
    const location = await gps(file);
    if (location && hasLocation(location)) return { latitude: location.latitude, longitude: location.longitude };
  } catch { /* Missing or damaged EXIF must not prevent uploading the image. */ }
  return { latitude: null, longitude: null };
}
