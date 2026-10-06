import { supabase } from '../supabase';
import type { UploadRequest, UploadResponse, UploadTarget } from '../photoUploadContract';
import { imageFormat } from './imageValidation';

export type PhotoUploadApi = {
  request(request: UploadRequest): Promise<UploadResponse>;
  transfer(target: UploadTarget, blob: Blob): Promise<void>;
  recover(path: string): Promise<Blob>;
};
export class UploadApiError extends Error {
  readonly pause_reason: 'capacity' | 'quota' | 'admission' | 'queue' | null;
  constructor(message: string, readonly status = 0) {
    super(message);
    this.pause_reason = /Uploads are paused/i.test(message) ? 'admission'
      : /Queue is full/i.test(message) ? 'queue'
      : /Storage capacity is paused/i.test(message) ? 'capacity'
      : /(?:Provider quota is paused|Moderation free allowance is paused)/i.test(message) ? 'quota' : null;
  }
  get retryable() { return this.pause_reason !== null || this.status === 0 || this.status >= 500 || [408, 429].includes(this.status); }
}
async function invocationError(error: { message: string; context?: unknown }): Promise<UploadApiError> {
  const response = error.context;
  if (response instanceof Response) {
    try {
      const body: unknown = await response.clone().json();
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string')
        return new UploadApiError(Array.from(body.error).map((character) => character.charCodeAt(0) < 32 ? ' ' : character).join('').slice(0, 256), response.status);
    } catch { /* Relay/non-JSON errors retain the generic transport message. */ }
    return new UploadApiError(error.message, response.status);
  }
  return new UploadApiError(error.message);
}
export const photoUploadApi: PhotoUploadApi = {
  async request(body) {
    if (!supabase) throw new Error('Photo uploads are not configured.');
    const { data, error } = await supabase.functions.invoke<UploadResponse>('photo-upload', { body });
    if (error) throw await invocationError(error);
    if (!data) throw new Error('The upload service returned an empty response.');
    return data;
  },
  async transfer(target, blob) {
    if (!supabase) throw new Error('Photo uploads are not configured.');
    // Files selected on some devices (notably HEIC) have an empty MIME type.
    // The trusted classifier still validates the actual immutable bytes.
    const supported = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
    const contentType = supported.includes(blob.type) ? blob.type
      : `image/${imageFormat(new Uint8Array(await blob.arrayBuffer()))}`;
    const { error } = await supabase.storage.from(target.bucket).upload(target.path, blob, {
      upsert: false, contentType, cacheControl: '0',
    });
    if (error) throw new UploadApiError(error.message, Number('statusCode' in error ? error.statusCode : 0) || 0);
  },
  async recover(path) {
    if (!supabase) throw new Error('Photo uploads are not configured.');
    const { data, error } = await supabase.storage.from('photo-quarantine').download(path);
    if (error || !data) throw new UploadApiError(error?.message || 'The original photo is unavailable.', Number(error && 'statusCode' in error ? error.statusCode : 0) || 0);
    return data;
  },
};
