import { gps } from 'exifr';
import { UPLOAD_LIMITS } from './photoUploadContract';

/**
 * exifr 7.1.3 rejects valid HEIC ftyp boxes larger than 50 bytes. Adapt only
 * its metadata input, not the uploaded source. A same-size free box keeps all
 * subsequent boxes and absolute EXIF item offsets in their original positions.
 */
async function legacyHeicGpsInput(file: File): Promise<Uint8Array | undefined> {
  if (file.size > UPLOAD_LIMITS.originalBytes || file.size < 52) return;
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (header.length !== 16 || String.fromCharCode(...header.subarray(4, 8)) !== 'ftyp') return;
  const length = new DataView(header.buffer).getUint32(0);
  // Only ordinary, complete, aligned ftyp boxes with a bounded brand list.
  // Extended/zero-length boxes and oversized metadata are not rewritten.
  if (length <= 50 || length > 4096 || length > file.size || length % 4 !== 0) return;
  const brands = new Uint8Array(await file.slice(0, length).arrayBuffer());
  if (brands.length !== length) return;
  const brand = (offset: number) => String.fromCharCode(...brands.subarray(offset, offset + 4));
  const compatible = [];
  for (let offset = 16; offset < length; offset += 4) compatible.push(brand(offset));
  const allBrands = [brand(8), ...compatible];
  if (!allBrands.some(value => ['heic', 'heix'].includes(value))
    || allBrands.some(value => ['hevc', 'hevx', 'msf1', 'avis', 'avif'].includes(value))) return;
  const input = new Uint8Array(await file.arrayBuffer());
  if (input.length !== file.size) return;
  const view = new DataView(input.buffer);
  // exifr searches for meta without checking forward progress. Only send the
  // fallback a bounded ordinary box chain ending in a complete full meta box.
  let foundMeta = false;
  for (let offset = length; offset + 8 <= input.length;) {
    const size = view.getUint32(offset);
    if (size < 8 || size > input.length - offset) return;
    if (String.fromCharCode(...input.subarray(offset + 4, offset + 8)) === 'meta') {
      if (size < 12) return;
      foundMeta = true;
      break;
    }
    offset += size;
  }
  if (!foundMeta) return;
  input.fill(0, 0, length);
  const text = new TextEncoder();
  view.setUint32(0, 24);
  input.set(text.encode('ftypheic'), 4);
  input.set(text.encode('mif1heic'), 16);
  view.setUint32(24, length - 24);
  input.set(text.encode('free'), 28);
  return input;
}

export type Coordinates = { latitude: number | null; longitude: number | null };
export function hasLocation<T extends Coordinates>(value: T): value is T & { latitude: number; longitude: number } {
  return typeof value.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
    && typeof value.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180;
}
export async function extractLocation(file: File): Promise<Coordinates> {
  try {
    let location;
    try { location = await gps(file); }
    catch {
      const input = await legacyHeicGpsInput(file);
      if (input) location = await gps(input);
    }
    if (location && hasLocation(location)) return { latitude: location.latitude, longitude: location.longitude };
  } catch { /* Missing or damaged EXIF must not prevent uploading the image. */ }
  return { latitude: null, longitude: null };
}
