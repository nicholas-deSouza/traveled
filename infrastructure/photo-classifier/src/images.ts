import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { InvalidImage, ORIGINAL_LIMIT, CANDIDATE_LIMIT, PIXEL_LIMIT, type PreparedImage } from './classifier.ts';

const require = createRequire(import.meta.url);
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'heic';
/** Container checks run before a decoder can silently select the first animation frame. */
export function detectFormat(input: Uint8Array, stage: 'original' | 'candidate' = 'original'): ImageFormat {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (b.length < 12) throw new InvalidImage('Unsupported or damaged image');
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    let offset = 8;
    while (offset + 12 <= b.length) {
      const size = b.readUInt32BE(offset); const type = b.toString('ascii', offset + 4, offset + 8);
      if (offset + size + 12 > b.length) throw new InvalidImage('Damaged PNG');
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new InvalidImage('Animated images are unsupported');
      offset += size + 12;
      if (type === 'IEND') break;
    }
    return 'png';
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    if (b.readUInt32LE(4) + 8 !== b.length) throw new InvalidImage('Damaged WebP');
    let offset = 12;
    while (offset + 8 <= b.length) {
      const size = b.readUInt32LE(offset + 4); const type = b.toString('ascii', offset, offset + 4);
      if (offset + size + 8 > b.length) throw new InvalidImage('Damaged WebP');
      if (stage === 'candidate' && (type === 'EXIF' || type === 'XMP ' ||
          (type === 'VP8X' && size > 0 && (b[offset + 8] & 12)))) {
        throw new InvalidImage('Candidate must not contain EXIF or XMP metadata');
      }
      if (type === 'ANIM' || type === 'ANMF' || (type === 'VP8X' && size > 0 && (b[offset + 8] & 2))) {
        throw new InvalidImage('Animated images are unsupported');
      }
      offset += 8 + size + (size % 2);
    }
    return 'webp';
  }
  if (b.toString('ascii', 4, 8) === 'ftyp') {
    const length = b.readUInt32BE(0);
    if (length < 16 || length > b.length || length > 4096) throw new InvalidImage('Damaged HEIC');
    const brands = [b.toString('ascii', 8, 12)];
    for (let offset = 16; offset + 4 <= length; offset += 4) brands.push(b.toString('ascii', offset, offset + 4));
    if (brands.some(brand => ['msf1','hevc','hevx','heim','heis'].includes(brand))) throw new InvalidImage('Image sequences are unsupported');
    if (brands.some(brand => ['heic','heix'].includes(brand))) return 'heic';
  }
  throw new InvalidImage('Supported formats are still JPEG, PNG, WebP and HEIC');
}

export function validateDimensions(width: number | undefined, height: number | undefined) {
  if (!width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height > PIXEL_LIMIT) {
    throw new InvalidImage('Image exceeds the 50 megapixel limit or has invalid dimensions');
  }
}

export type ImageInspection = {
  format?: string; width?: number; height?: number; pages?: number;
  exif?: Uint8Array; xmp?: Uint8Array | string;
};
/** Enforce gallery output constraints against decoder inspection, including bypassed browser processing. */
export function validateInspection(metadata: ImageInspection, format: ImageFormat, stage: 'original' | 'candidate') {
  validateDimensions(metadata.width, metadata.height);
  if (metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new InvalidImage('Unsupported or animated image');
  if (stage === 'candidate') {
    if (format !== 'webp') throw new InvalidImage('Candidate must be still WebP');
    if (Math.max(metadata.width!, metadata.height!) > 2560) throw new InvalidImage('Candidate exceeds maximum dimensions');
    if (metadata.exif !== undefined || metadata.xmp !== undefined) throw new InvalidImage('Candidate must not contain EXIF or XMP metadata');
  }
}

type HeifImage = {
  get_width(): number; get_height(): number; free?(): void;
  display(image: { data: Uint8ClampedArray; width: number; height: number }, callback: (result: { data: Uint8ClampedArray; width: number; height: number } | null) => void): void;
};
export type HeifModule = {
  HeifDecoder: new () => { decoder: number | null; decode(bytes: Uint8Array): HeifImage[] };
  heif_js_context_get_list_of_top_level_image_IDs(context: number): number[];
  heif_context_free(context: number): void;
};
let heifModule: Promise<HeifModule> | undefined;
async function heif() {
  // libheif-js/wasm reads a relative cwd path; initialize its factory with absolute packaged WASM instead.
  heifModule ??= (async () => {
    const root = dirname(require.resolve('libheif-js/package.json'));
    const factory = require(join(root, 'libheif-wasm/libheif.js'));
    return await factory({ wasmBinary: await readFile(join(root, 'libheif-wasm/libheif.wasm')) }) as HeifModule;
  })();
  return heifModule;
}

export async function decodeHeic(input: Uint8Array, lib: HeifModule) {
  const decoder = new lib.HeifDecoder();
  let images: HeifImage[] = [];
  try {
    try { images = decoder.decode(input); } catch { throw new InvalidImage('Damaged HEIC'); }
    // Count IDs too: a decoder that drops a failed extra handle must not turn a multi-photo file into a still.
    const ids = decoder.decoder ? lib.heif_js_context_get_list_of_top_level_image_IDs(decoder.decoder) : [];
    if (images.length !== 1 || ids.length !== 1) throw new InvalidImage('HEIC must contain one top-level photo');
    const image = images[0]; const width = image.get_width(); const height = image.get_height();
    validateDimensions(width, height);
    const rgba = await new Promise<Uint8ClampedArray>((resolve, reject) => {
      image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, result => {
        if (!result) reject(new InvalidImage('Damaged HEIC')); else resolve(result.data);
      });
    });
    return { rgba, width, height };
  } finally {
    for (const image of images) image.free?.();
    if (decoder.decoder) { lib.heif_context_free(decoder.decoder); decoder.decoder = null; }
  }
}

export async function prepareImage(input: Uint8Array, stage: 'original' | 'candidate'): Promise<PreparedImage> {
  if (input.byteLength > (stage === 'candidate' ? CANDIDATE_LIMIT : ORIGINAL_LIMIT)) throw new InvalidImage('Image exceeds byte limit');
  const format = detectFormat(input, stage);
  if (stage === 'candidate' && format !== 'webp') throw new InvalidImage('Candidate must be still WebP');
  const { default: sharp } = await import('sharp');
  let pipeline;
  if (format === 'heic') {
    const { rgba, width, height } = await decodeHeic(input, await heif());
    // libheif applies HEIF rotation/mirroring during display. Sharp sees already oriented RGBA.
    pipeline = sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 }, limitInputPixels: PIXEL_LIMIT });
  } else {
    pipeline = sharp(input, { animated: true, limitInputPixels: PIXEL_LIMIT, failOn: 'warning' });
    try {
      const metadata = await pipeline.metadata();
      validateInspection(metadata, format, stage);
      // Force complete decoding; metadata inspection alone can accept truncated/corrupt images.
      await pipeline.clone().stats();
    } catch (error) {
      if (error instanceof InvalidImage) throw error;
      throw new InvalidImage('Damaged image or invalid dimensions');
    }
    if (input.byteLength <= CANDIDATE_LIMIT) return { bytes: input, mime: `image/${format}` as PreparedImage['mime'] };
  }
  try {
    const bytes = await pipeline.rotate().resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
    if (bytes.byteLength > CANDIDATE_LIMIT) throw new InvalidImage('Classification image exceeds byte limit');
    return { bytes, mime: 'image/jpeg' };
  } catch (error) {
    if (error instanceof InvalidImage) throw error;
    throw new InvalidImage('Image decoding failed');
  }
}
