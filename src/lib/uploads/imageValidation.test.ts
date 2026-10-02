import { describe, expect, it } from 'vitest';
import { assertSourceSize, imageDimensions, imageFormat } from './imageValidation';
describe('photo limits', () => {
  it('preserves the complete scene, scales the longest edge and never upscales', () => {
    expect(imageDimensions(6000, 4000)).toEqual({ width: 2560, height: 1707 });
    expect(imageDimensions(400, 600)).toEqual({ width: 400, height: 600 });
    expect(() => imageDimensions(10000, 6000)).toThrow('50 megapixels');
    expect(() => assertSourceSize(20 * 1024 * 1024 + 1)).toThrow('20 MiB');
  });
  it('validates actual signatures rather than filenames and rejects GIF', () => {
    expect(imageFormat(new Uint8Array([255, 216, 255]))).toBe('jpeg');
    expect(() => imageFormat(new TextEncoder().encode('GIF89a'))).toThrow('still JPEG');
    expect(imageFormat(new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode('ftypheic')]))).toBe('heic');
  });
  it('rejects animated PNG and WebP before decoding', () => {
    const png = new Uint8Array(20); png.set([137, 80, 78, 71]); png.set(new TextEncoder().encode('acTL'), 12);
    expect(() => imageFormat(png)).toThrow('Animated');
    const webp = new Uint8Array(22); webp.set(new TextEncoder().encode('RIFF')); webp.set(new TextEncoder().encode('WEBP'), 8);
    webp.set(new TextEncoder().encode('VP8X'), 12); webp[16] = 2; webp[20] = 2;
    expect(() => imageFormat(webp)).toThrow('Animated');
  });
});
