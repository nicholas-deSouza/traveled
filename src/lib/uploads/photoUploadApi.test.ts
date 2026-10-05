import { beforeEach, describe, expect, it, vi } from 'vitest';
import { photoUploadApi, UploadApiError } from './photoUploadApi';
const fake = vi.hoisted(() => ({ invoke: vi.fn(), upload: vi.fn(), download: vi.fn(), from: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { functions: { invoke: fake.invoke }, storage: { from: fake.from } } }));
beforeEach(() => { vi.resetAllMocks(); fake.from.mockReturnValue({ upload: fake.upload, download: fake.download }); });
describe('authenticated upload boundary', () => {
  it('passes actions through the authenticated Edge boundary without client verdicts', async () => {
    fake.invoke.mockResolvedValue({ data: { submissions: [] }, error: null });
    expect(await photoUploadApi.request({ action: 'list' })).toEqual({ submissions: [] });
    expect(fake.invoke).toHaveBeenCalledWith('photo-upload', { body: { action: 'list' } });
  });
  it('transfers only to the server target and disallows overwriting an immutable object', async () => {
    fake.upload.mockResolvedValue({ error: null }); const blob = new Blob(['photo'], { type: 'image/webp' });
    await photoUploadApi.transfer({ bucket: 'photo-quarantine', path: 'server/path', generation: 1 }, blob);
    expect(fake.from).toHaveBeenCalledWith('photo-quarantine');
    expect(fake.upload).toHaveBeenCalledWith('server/path', blob, { upsert: false, contentType: 'image/webp', cacheControl: '0' });
  });
  it('uses authenticated private recovery and rejects missing objects', async () => {
    fake.download.mockResolvedValue({ data: null, error: { message: 'Access denied' } });
    await expect(photoUploadApi.recover('original/path')).rejects.toThrow('Access denied');
    expect(fake.download).toHaveBeenCalledWith('original/path');
  });
  it('declares the actual supported format when a device supplies no MIME type', async () => {
    fake.upload.mockResolvedValue({ error: null });
    const bytes = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic')]);
    const source = { type: '', arrayBuffer: async () => bytes.buffer } as Blob;
    await photoUploadApi.transfer({ bucket: 'photo-quarantine', path: 'original/empty-mime', generation: 0 }, source);
    expect(fake.upload).toHaveBeenCalledWith('original/empty-mime', source, { upsert: false, contentType: 'image/heic', cacheControl: '0' });
  });
  it('preserves bounded server pause feedback instead of hiding it behind a generic non-2xx message', async () => {
    fake.invoke.mockResolvedValue({ data: null, error: { message: 'Edge Function returned a non-2xx status code',
      context: new Response(JSON.stringify({ error: 'Storage capacity is paused' }), { status: 503 }) } });
    const error = await photoUploadApi.request({ action: 'list' }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(UploadApiError);
    expect(error).toMatchObject({ message: 'Storage capacity is paused', status: 503, pause_reason: 'capacity', retryable: true });
  });
});

it.each([
  ['Uploads are paused', 'admission'],
  ['Queue is full', 'queue'],
  ['Storage capacity is paused', 'capacity'],
  ['Provider quota is paused', 'quota'],
])('distinguishes %s and keeps the pause retryable', (message, reason) => {
  expect(new UploadApiError(message, 503)).toMatchObject({ pause_reason: reason, retryable: true });
});
