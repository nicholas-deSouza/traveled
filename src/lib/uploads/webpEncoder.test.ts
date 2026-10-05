import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';

const codec = vi.hoisted(() => ({ init: vi.fn(), encode: vi.fn() }));
vi.mock('@jsquash/webp/encode.js', () => ({ init: codec.init, default: codec.encode }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); codec.init.mockReset(); codec.encode.mockReset(); });

it('initializes packaged SIMD and non-SIMD assets once and encodes at quality 80', async () => {
  vi.stubGlobal('Blob', NodeBlob);
  codec.init.mockResolvedValue({});
  codec.encode.mockResolvedValue(new Uint8Array([82, 73, 70, 70]).buffer);
  const { encodeWebp } = await import('./webpEncoder');
  const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]), colorSpace: 'srgb' } as ImageData;
  const result = await encodeWebp(pixels);
  await encodeWebp(pixels);
  expect(codec.init).toHaveBeenCalledOnce();
  const { locateFile } = codec.init.mock.calls[0][0];
  expect(locateFile('webp_enc.wasm')).toContain('webp_enc.wasm');
  expect(locateFile('webp_enc_simd.wasm')).toContain('webp_enc_simd.wasm');
  expect(codec.encode).toHaveBeenCalledWith(pixels, { quality: 80 });
  expect(result.type).toBe('image/webp');
  expect(new Uint8Array(await result.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70]));
});

it('rejects when WASM initialization fails instead of producing a mislabeled photo', async () => {
  codec.init.mockRejectedValue(new Error('WASM unavailable'));
  const { encodeWebp } = await import('./webpEncoder');
  await expect(encodeWebp({} as ImageData)).rejects.toThrow('WASM unavailable');
  expect(codec.encode).not.toHaveBeenCalled();
});
