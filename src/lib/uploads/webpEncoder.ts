import encode, { init } from '@jsquash/webp/encode.js';
import wasmUrl from '@jsquash/webp/codec/enc/webp_enc.wasm?url';
import simdWasmUrl from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url';
import { UPLOAD_LIMITS } from '../photoUploadContract';

// Explicit asset URLs let Vite package both codecs for development and production.
// This module is loaded only inside the photo worker when native encoding fails.
let ready: ReturnType<typeof init> | undefined;
export async function encodeWebp(pixels: ImageData): Promise<Blob> {
  ready ??= init({ locateFile: (path: string) => path.endsWith('webp_enc_simd.wasm') ? simdWasmUrl : wasmUrl });
  await ready;
  const bytes = await encode(pixels, { quality: UPLOAD_LIMITS.quality * 100 });
  return new Blob([bytes], { type: 'image/webp' });
}
