import { UPLOAD_LIMITS } from '../photoUploadContract';
import { imageDimensions, imageFormat, assertSourceSize } from './imageValidation';
import { advisoryPrecheck } from './advisory';

async function decodePhoto(source: Blob): Promise<ImageBitmap> {
  assertSourceSize(source.size);
  const bytes = new Uint8Array(await source.arrayBuffer());
  const format = imageFormat(bytes);
  let bitmap: ImageBitmap;
  if (format === 'heic') {
    const { initializeHeicDecoder } = await import('./heicDecoder');
    const library = await initializeHeicDecoder();
    const decoder = new library.HeifDecoder();
    let images: ReturnType<typeof decoder.decode> = [];
    try {
      images = decoder.decode(bytes);
      const ids = decoder.decoder ? library.heif_js_context_get_list_of_top_level_image_IDs(decoder.decoder) : [];
      if (images.length !== 1 || ids.length !== 1) throw new Error('HEIC files must contain exactly one photo.');
      const image = images[0];
      const width = image.get_width(), height = image.get_height();
      imageDimensions(width, height);
      const pixels = new ImageData(width, height);
      await new Promise<void>((resolve, reject) => image.display(pixels, (data) => {
        if (data) resolve(); else reject(new Error('The HEIC photo could not be decoded.'));
      }));
      bitmap = await createImageBitmap(pixels);
    } finally {
      for (const image of images) image.free();
      if (decoder.decoder) { library.heif_context_free(decoder.decoder); decoder.decoder = null; }
    }
  } else {
    bitmap = await createImageBitmap(new Blob([bytes], { type: `image/${format}` }), { imageOrientation: 'from-image' });
  }
  return bitmap;
}
export async function optimizePhoto(source: Blob): Promise<{ blob: Blob }> {
  const bitmap = await decodePhoto(source);
  try {
    const dimensions = imageDimensions(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(dimensions.width, dimensions.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser cannot process photos.');
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    let blob: Blob | undefined;
    try { blob = await canvas.convertToBlob({ type: 'image/webp', quality: UPLOAD_LIMITS.quality }); }
    catch { /* Fall back to the bundled encoder when native encoding fails. */ }
    if (blob?.type !== 'image/webp') {
      const { encodeWebp } = await import('./webpEncoder');
      blob = await encodeWebp(context.getImageData(0, 0, dimensions.width, dimensions.height));
    }
    if (blob.size > UPLOAD_LIMITS.candidateBytes) throw new Error('The optimized photo exceeds 8 MiB. Choose a smaller photo.');
    return { blob };
  } finally { bitmap.close(); }
}
export async function precheckPhoto(source: Blob): Promise<{ advisory: boolean | null }> {
  const bitmap = await decodePhoto(source);
  try {
    imageDimensions(bitmap.width, bitmap.height);
    const preview = new OffscreenCanvas(224, 224);
    const context = preview.getContext('2d');
    if (!context) return { advisory: null };
    context.drawImage(bitmap, 0, 0, 224, 224);
    return { advisory: await advisoryPrecheck(context.getImageData(0, 0, 224, 224), () => import('nsfwjs')) };
  } finally { bitmap.close(); }
}
/** A small, browser-readable selection preview using the same HEIC safety checks. */
export async function previewPhoto(source: Blob): Promise<{ blob: Blob }> {
  const bitmap = await decodePhoto(source);
  try {
    imageDimensions(bitmap.width, bitmap.height);
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser cannot preview this photo.');
    context.drawImage(bitmap, 0, 0, width, height);
    return { blob: await canvas.convertToBlob({ type: 'image/png' }) };
  } finally { bitmap.close(); }
}
// Dedicated worker; nothing on the main thread executes this handler.
self.onmessage = async (event: MessageEvent<{ source: Blob; advisory?: boolean; preview?: boolean }>) => {
  try { self.postMessage(event.data.preview ? await previewPhoto(event.data.source) : event.data.advisory ? await precheckPhoto(event.data.source) : await optimizePhoto(event.data.source)); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'The photo could not be processed.' }); }
};
