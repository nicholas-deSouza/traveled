import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { optimizePhoto, previewPhoto } from './processing.worker';

const heif = vi.hoisted(() => ({ initialize: vi.fn() }));
const fallback = vi.hoisted(() => ({ encodeWebp: vi.fn() }));
vi.mock('./webpEncoder', () => fallback);
vi.mock('./heicDecoder', () => ({ initializeHeicDecoder: heif.initialize }));
const jpeg = () => new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' });
const heic = () => new Blob([new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic')])]);
let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
let draw: ReturnType<typeof vi.fn>, encode: ReturnType<typeof vi.fn>, getImageData: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob);
  bitmap = { width: 3200, height: 1600, close: vi.fn() };
  draw = vi.fn(); encode = vi.fn(async () => new Blob(['candidate'], { type: 'image/webp' }));
  fallback.encodeWebp.mockReset().mockResolvedValue(new Blob(['wasm candidate'], { type: 'image/webp' }));
  getImageData = vi.fn((x, y, width, height) => new ImageData(width, height));
  vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap));
  vi.stubGlobal('ImageData', class {
    data: Uint8ClampedArray;
    constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); }
  });
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { drawImage: draw, getImageData }; }
    convertToBlob = encode;
  });
});
afterEach(() => { vi.unstubAllGlobals(); heif.initialize.mockReset(); });

function decoderFixture(ids = [1], count = 1, failsDisplay = false) {
  const context = {};
  const image = { get_width: () => 4, get_height: () => 2, free: vi.fn(),
    display: vi.fn((pixels: ImageData, done: (pixels: ImageData | null) => void) => done(failsDisplay ? null : pixels)) };
  const images = Array.from({ length: count }, () => ({ ...image, free: vi.fn() }));
  const decode = vi.fn(() => images), free = vi.fn();
  const decoder = { decoder: context as object | number | null, decode };
  heif.initialize.mockResolvedValue({ HeifDecoder: class { constructor() { return decoder; } },
    heif_js_context_get_list_of_top_level_image_IDs: vi.fn(() => ids), heif_context_free: free });
  return { context, images, decoder, free };
}

describe('actual photo-processing implementation', () => {
  it('keeps aspect ratio, requests orientation and WebP quality, and releases the bitmap', async () => {
    const source = jpeg();
    expect((await optimizePhoto(source)).blob.type).toBe('image/webp');
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: 'from-image' });
    expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, 2560, 1280);
    expect(encode).toHaveBeenCalledWith({ type: 'image/webp', quality: 0.8 });
    expect(fallback.encodeWebp).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it.each(['png', 'throws'] as const)('uses resized pixels in the fallback when native encoding %s', async failure => {
    if (failure === 'png') encode.mockResolvedValue(new Blob(['fallback'], { type: 'image/png' }));
    else encode.mockRejectedValue(new Error('EncodingError'));
    const result = await optimizePhoto(jpeg());
    expect(result.blob.type).toBe('image/webp');
    expect(getImageData).toHaveBeenCalledWith(0, 0, 2560, 1280);
    expect(fallback.encodeWebp).toHaveBeenCalledWith(expect.objectContaining({ width: 2560, height: 1280 }));
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it.each(['native', 'fallback'] as const)('rejects oversized %s output and releases the bitmap', async encoder => {
    const oversized = new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'image/webp' });
    if (encoder === 'native') encode.mockResolvedValue(oversized);
    else {
      encode.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
      fallback.encodeWebp.mockResolvedValue(oversized);
    }
    await expect(optimizePhoto(jpeg())).rejects.toThrow('8 MiB');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('propagates fallback failures and releases the bitmap', async () => {
    encode.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    fallback.encodeWebp.mockRejectedValue(new Error('Encoder unavailable'));
    await expect(optimizePhoto(jpeg())).rejects.toThrow('Encoder unavailable');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('rejects decoded dimensions above the pixel limit and closes the bitmap', async () => {
    bitmap.width = 10000; bitmap.height = 5001;
    await expect(optimizePhoto(jpeg())).rejects.toThrow('50 megapixels');
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(draw).not.toHaveBeenCalled();
  });
  it('decodes a single top-level HEIC photo and frees images and the native context', async () => {
    const fixture = decoderFixture();
    await optimizePhoto(heic());
    expect(fixture.images[0].display).toHaveBeenCalledOnce();
    expect(fixture.images[0].free).toHaveBeenCalledOnce();
    expect(fixture.free).toHaveBeenCalledWith(fixture.context);
    expect(fixture.decoder.decoder).toBeNull();
  });
  it.each([{ ids: [1, 2] }, { ids: [] }])('rejects a top-level count mismatch even when only one decoded image remains: $ids', async ({ ids }) => {
    const fixture = decoderFixture(ids);
    await expect(optimizePhoto(heic())).rejects.toThrow('exactly one photo');
    expect(fixture.images[0].free).toHaveBeenCalledOnce();
    expect(fixture.free).toHaveBeenCalledOnce();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
  it('frees every image when multiple decoded photos are rejected', async () => {
    const fixture = decoderFixture([1, 2], 2);
    await expect(optimizePhoto(heic())).rejects.toThrow('exactly one photo');
    for (const image of fixture.images) expect(image.free).toHaveBeenCalledOnce();
    expect(fixture.free).toHaveBeenCalledOnce();
  });
  it('frees the native context when HEIC display fails', async () => {
    const fixture = decoderFixture([1], 1, true);
    await expect(optimizePhoto(heic())).rejects.toThrow('could not be decoded');
    expect(fixture.free).toHaveBeenCalledOnce();
    expect(fixture.images[0].free).toHaveBeenCalledOnce();
  });
  it('checks HEIC decoded dimensions before allocating/displaying pixels', async () => {
    const fixture = decoderFixture();
    fixture.images[0].get_width = () => 10000;
    fixture.images[0].get_height = () => 5001;
    await expect(optimizePhoto(heic())).rejects.toThrow('50 megapixels');
    expect(fixture.images[0].display).not.toHaveBeenCalled();
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(fixture.images[0].free).toHaveBeenCalledOnce();
    expect(fixture.free).toHaveBeenCalledOnce();
  });
  it('releases the HEIC context if the decoder throws before returning handles', async () => {
    const fixture = decoderFixture();
    fixture.decoder.decode.mockImplementation(() => { throw new Error('Decoder security limit exceeded'); });
    await expect(optimizePhoto(heic())).rejects.toThrow('security limit');
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(fixture.free).toHaveBeenCalledOnce();
    expect(fixture.decoder.decoder).toBeNull();
  });
});

it('decodes HEIC selection previews as bounded PNGs and releases the native resources', async () => {
  const fixture = decoderFixture();
  encode.mockResolvedValue(new Blob(['preview'], { type: 'image/png' }));
  expect((await previewPhoto(heic())).blob.type).toBe('image/png');
  expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, 320, 160);
  expect(encode).toHaveBeenCalledWith({ type: 'image/png' });
  expect(fixture.images[0].free).toHaveBeenCalledOnce();
  expect(fixture.free).toHaveBeenCalledOnce();
  expect(bitmap.close).toHaveBeenCalledOnce();
});
