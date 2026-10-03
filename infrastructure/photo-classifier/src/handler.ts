import { createClassifier, InvalidImage, ORIGINAL_LIMIT, type PreparedImage } from './classifier.ts';
import { prepareImage } from './images.ts';
import type { ClassificationRequest } from '../../../src/lib/photoUploadContract.ts';

function configuration(name: string) {
  const value = process.env[name];
  if (!value) throw new Error('Classifier configuration missing');
  return value;
}
export async function download(request: ClassificationRequest, signal: AbortSignal): Promise<Uint8Array> {
  const base = new URL(configuration('SUPABASE_URL'));
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Invalid Storage configuration');
  const key = configuration('SUPABASE_SECRET_KEY');
  if (!key.startsWith('sb_secret_') || key.length <= 'sb_secret_'.length) throw new Error('Invalid Storage credential configuration');
  const url = new URL(`/storage/v1/object/authenticated/${request.bucket}/${request.path.split('/').map(encodeURIComponent).join('/')}`, base);
  const response = await fetch(url, { headers: { apikey: key }, signal, redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('Storage download unavailable');
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > ORIGINAL_LIMIT) throw new InvalidImage('Image exceeds byte limit');
  const chunks: Uint8Array[] = []; let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > ORIGINAL_LIMIT || length > request.expected_bytes) {
        await reader.cancel(); throw new InvalidImage('Stored image exceeds expected byte limit');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}
export async function moderate(image: PreparedImage, signal: AbortSignal) {
  const form = new FormData();
  // Use only the in-memory bytes. Never forward Storage URLs, GPS, filenames, credentials or provider bodies into logs.
  form.append('media', new Blob([new Uint8Array(image.bytes)], { type: image.mime }), `photo.${image.mime.split('/')[1]}`);
  form.append('models', 'nudity-2.1');
  form.append('api_user', configuration('SIGHTENGINE_API_USER'));
  form.append('api_secret', configuration('SIGHTENGINE_API_SECRET'));
  const response = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body: form, signal, redirect: 'error' });
  // Cap provider responses as well; successful HTTP responses still need a valid verdict payload.
  let text = ''; let length = 0;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 64 * 1024) { await reader.cancel(); throw new Error('Invalid provider response'); }
        chunks.push(value);
      }
      text = Buffer.concat(chunks, length).toString('utf8');
    } finally { reader.releaseLock(); }
  }
  const body: unknown = (() => { try { return JSON.parse(text); } catch { return null; } })();
  return { status: response.status, body, retryAfter: response.headers.get('retry-after') };
}
export const handler = createClassifier({ download, prepare: prepareImage, moderate });
