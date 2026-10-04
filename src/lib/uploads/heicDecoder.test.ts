import { afterEach, expect, it, vi } from 'vitest';
import { initializeHeicDecoder } from './heicDecoder';

const factory = vi.hoisted(() => vi.fn());
vi.mock('../../../vendor/libheif-1.23.5/libheif-browser.mjs', () => ({ default: factory }));
vi.mock('../../../vendor/libheif-1.23.5/libheif.wasm?url', () => ({ default: '/assets/reviewed-heif.wasm' }));
afterEach(() => { vi.unstubAllGlobals(); factory.mockReset(); });

it('loads the emitted WASM asset and supplies bytes to the pinned factory', async () => {
  const bytes = Uint8Array.from([0, 97, 115, 109]);
  const request = vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer }));
  vi.stubGlobal('fetch', request);
  const library = { heif_get_version: () => '1.23.5' };
  factory.mockReturnValue(library);
  expect(await initializeHeicDecoder()).toBe(library);
  expect(request).toHaveBeenCalledWith('/assets/reviewed-heif.wasm');
  expect(factory).toHaveBeenCalledWith({ wasmBinary: bytes });
});
it('rejects a failed WASM download before initialization', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  await expect(initializeHeicDecoder()).rejects.toThrow('could not be loaded');
  expect(factory).not.toHaveBeenCalled();
});
it('rejects an unexpected decoder version', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })));
  factory.mockReturnValue({ heif_get_version: () => '1.23.2' });
  await expect(initializeHeicDecoder()).rejects.toThrow('version is invalid');
});
