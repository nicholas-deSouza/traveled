import { UPLOAD_LIMITS } from '../photoUploadContract';
export function assertSourceSize(size: number) {
  if (!Number.isInteger(size) || size <= 0 || size > UPLOAD_LIMITS.originalBytes)
    throw new Error('Choose a photo no larger than 20 MiB.');
}
export function imageDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > UPLOAD_LIMITS.pixels)
    throw new Error('Photos must be no larger than 50 megapixels.');
  const scale = Math.min(1, UPLOAD_LIMITS.longEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heic';
export function imageFormat(bytes: Uint8Array): ImageFormat {
  const text = (offset: number, count: number) => String.fromCharCode(...bytes.subarray(offset, offset + count));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 137 && text(1, 3) === 'PNG') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (text(offset + 4, 4) === 'acTL') throw new Error('Animated photos are not supported.');
      if (length > bytes.length - offset - 12) throw new Error('The PNG photo is damaged.');
      offset += 12 + length;
    }
    return 'png';
  }
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = text(offset, 4); const length = view.getUint32(offset + 4, true);
      if (kind === 'ANIM' || kind === 'ANMF' || (kind === 'VP8X' && (bytes[offset + 8] & 2)))
        throw new Error('Animated photos are not supported.');
      if (length > bytes.length - offset - 8) throw new Error('The WebP photo is damaged.');
      offset += 8 + length + (length % 2);
    }
    return 'webp';
  }
  if (text(4, 4) === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1'].includes(text(8, 4))) return 'heic';
  throw new Error('Choose a still JPEG, PNG, WebP, or HEIC photo.');
}
export async function fingerprint(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
/** Reject unsupported containers before reserving capacity or attempting a transfer. */
export async function validateSourceFile(file: Blob): Promise<void> {
  assertSourceSize(file.size);
  imageFormat(new Uint8Array(await file.arrayBuffer()));
}
