import { Buffer, File as NodeFile } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { gps } from 'exifr';
import { extractLocation, hasLocation } from './photoMetadata';

vi.mock('exifr', async importOriginal => {
  const actual = await importOriginal<typeof import('exifr')>();
  return { ...actual, gps: vi.fn(actual.gps) };
});

// Synthetic metadata only: no private photos or real locations. Absolute item
// offsets deliberately exercise the layout that a shortened ftyp would break.
function u32(value: number) { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; }
function box(type: string, payload: Buffer) { return Buffer.concat([u32(payload.length + 8), Buffer.from(type), payload]); }
function syntheticTiff(little = true, negative = false) {
  const tiff = Buffer.alloc(128);
  const word = (value: number, offset: number) => little ? tiff.writeUInt16LE(value, offset) : tiff.writeUInt16BE(value, offset);
  const long = (value: number, offset: number) => little ? tiff.writeUInt32LE(value, offset) : tiff.writeUInt32BE(value, offset);
  tiff.write(little ? 'II' : 'MM'); word(42, 2); long(8, 4);
  word(1, 8); word(0x8825, 10); word(4, 12); long(1, 14); long(26, 18);
  word(4, 26);
  const entry = (offset: number, tag: number, type: number, count: number, value: number) => {
    word(tag, offset); word(type, offset + 2); long(count, offset + 4); long(value, offset + 8);
  };
  entry(28, 1, 2, 2, 0); tiff.write(negative ? 'S' : 'N', 36);
  entry(40, 2, 5, 3, 80);
  entry(52, 3, 2, 2, 0); tiff.write(negative ? 'W' : 'E', 60);
  entry(64, 4, 5, 3, 104);
  for (const offset of [80, 88, 96, 104, 112, 120]) long(1, offset + 4);
  if (negative) { long(10, 80); long(20, 104); }
  return tiff;
}
function syntheticHeic({ length = 52, distant = false, little = true, negative = false, exif = true } = {}) {
  const ftyp = Buffer.alloc(length);
  ftyp.writeUInt32BE(length); ftyp.write('ftypheic', 4);
  for (let offset = 16; offset + 4 <= length; offset += 4) ftyp.write(offset === 16 ? 'mif1' : 'heic', offset);
  const infe = box('infe', Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 1, 0, 0]), Buffer.from('Exif\0')]));
  const iinf = box('iinf', Buffer.concat([Buffer.alloc(4), Buffer.from([0, 1]), infe]));
  const tiff = syntheticTiff(little, negative);
  const payload = Buffer.concat([u32(0), tiff]);
  const ilocPayload = Buffer.alloc(22);
  ilocPayload[4] = 0x44; // four-byte offset/length, no base offset
  ilocPayload.writeUInt16BE(1, 6); ilocPayload.writeUInt16BE(1, 8);
  ilocPayload.writeUInt16BE(1, 12); ilocPayload.writeUInt32BE(payload.length, 18);
  let meta = box('meta', Buffer.concat([Buffer.alloc(4), iinf, box('iloc', ilocPayload)]));
  const padding = distant ? box('free', Buffer.alloc(45000)) : Buffer.alloc(0);
  ilocPayload.writeUInt32BE(ftyp.length + padding.length + meta.length + 8, 14);
  meta = box('meta', exif ? Buffer.concat([Buffer.alloc(4), iinf, box('iloc', ilocPayload)]) : Buffer.alloc(4));
  return Buffer.concat([ftyp, padding, meta, box('mdat', payload)]);
}
const source = (bytes: Buffer) => new NodeFile([bytes], 'synthetic.heic', { type: 'image/heic' }) as unknown as File;
function browserSource(bytes: Buffer) {
  const file = new File([new Uint8Array(bytes)], 'synthetic.heic', { type: 'image/heic' });
  // JSDOM implements FileReader but not Blob.arrayBuffer. Supply that modern
  // browser API locally while retaining a genuine browser File for exifr.
  const modern = source(bytes);
  const nativeSlice = file.slice.bind(file);
  Object.defineProperties(file, {
    arrayBuffer: { value: () => modern.arrayBuffer() },
    slice: { value: (start?: number, end?: number) => {
      const slice = nativeSlice(start, end);
      Object.defineProperty(slice, 'arrayBuffer', { value: () => modern.slice(start, end).arrayBuffer() });
      return slice;
    } },
  });
  return file;
}

describe('photo GPS metadata', () => {
  it.each([52, 64, 4096])('recovers GPS from a %i-byte HEIC header with the real exifr parser', async length => {
    const bytes = syntheticHeic({ length, distant: true });
    await expect(gps(new Uint8Array(bytes))).rejects.toThrow('Unknown file format');
    const file = browserSource(bytes);
    await expect(gps(file)).rejects.toThrow('Unknown file format');
    vi.mocked(gps).mockClear();
    await expect(extractLocation(file)).resolves.toEqual({ latitude: 0, longitude: 0 });
    const input = vi.mocked(gps).mock.calls[1][0] as Uint8Array;
    expect(input).toBeInstanceOf(Uint8Array);
    expect(input.length).toBe(bytes.length);
    const normalized = Buffer.from(input);
    expect(normalized.readUInt32BE(0)).toBe(24);
    expect(normalized.toString('ascii', 4, 12)).toBe('ftypheic');
    expect(normalized.toString('ascii', 16, 24)).toBe('mif1heic');
    expect(normalized.readUInt32BE(24)).toBe(length - 24);
    expect(normalized.toString('ascii', 28, 32)).toBe('free');
    expect(normalized.subarray(length)).toEqual(bytes.subarray(length));
    expect(Buffer.from(await file.arrayBuffer())).toEqual(bytes);
  });

  it.each([true, false])('retains south/west GPS signs with TIFF little-endian=%s', async little => {
    await expect(extractLocation(source(syntheticHeic({ little, negative: true })))).resolves.toEqual({ latitude: -10, longitude: -20 });
  });

  it('keeps the normal browser FileReader path for already-supported HEIC', async () => {
    const bytes = syntheticHeic({ length: 48 });
    const file = new File([new Uint8Array(bytes)], 'synthetic.heic', { type: 'image/heic' });
    await expect(extractLocation(file)).resolves.toEqual({ latitude: 0, longitude: 0 });
    expect(vi.mocked(gps)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(gps)).toHaveBeenCalledWith(file);
  });

  it('preserves the normal JPEG metadata reader and zero GPS', async () => {
    const payload = Buffer.concat([Buffer.from('Exif\0\0'), syntheticTiff()]);
    const segment = Buffer.alloc(4); segment[0] = 255; segment[1] = 225; segment.writeUInt16BE(payload.length + 2, 2);
    const bytes = Buffer.concat([Buffer.from([255, 216]), segment, payload, Buffer.from([255, 217])]);
    const file = new File([new Uint8Array(bytes)], 'synthetic.jpg', { type: 'image/jpeg' });
    await expect(extractLocation(file)).resolves.toEqual({ latitude: 0, longitude: 0 });
    expect(vi.mocked(gps)).toHaveBeenCalledTimes(1);
  });

  it('returns no location for absent or damaged EXIF without failing the upload', async () => {
    await expect(extractLocation(source(syntheticHeic({ exif: false })))).resolves.toEqual({ latitude: null, longitude: null });
    const damaged = syntheticHeic(); damaged.fill(0, damaged.length - 128);
    await expect(extractLocation(source(damaged))).resolves.toEqual({ latitude: null, longitude: null });
  });

  it.each(['truncated', 'oversized', 'beyond-file', 'misaligned', 'extended', 'zero', 'avif', 'generic', 'misleading', 'stalled', 'missing-meta'])('does not adapt %s containers', async kind => {
    let bytes = syntheticHeic();
    if (kind === 'truncated') bytes = bytes.subarray(0, 15);
    if (kind === 'oversized') bytes.writeUInt32BE(4100);
    if (kind === 'beyond-file') bytes.writeUInt32BE(4096);
    if (kind === 'misaligned') bytes.writeUInt32BE(51);
    if (kind === 'extended') bytes.writeUInt32BE(1);
    if (kind === 'zero') bytes.writeUInt32BE(0);
    if (kind === 'avif') { bytes.write('avif', 8); bytes.write('avif', 20); }
    if (kind === 'generic') { bytes.fill(0, 8, 52); bytes.write('mif1', 8); }
    if (kind === 'misleading') { bytes.fill(0, 8, 52); bytes.write('heic', 9); }
    if (kind === 'stalled') { bytes.writeUInt32BE(0, 52); bytes.write('free', 56); }
    if (kind === 'missing-meta') bytes.write('free', 56);
    await expect(extractLocation(source(bytes))).resolves.toEqual({ latitude: null, longitude: null });
    expect(vi.mocked(gps)).toHaveBeenCalledTimes(1);
  });

  it('validates coordinate bounds, finite numbers, and zero values', () => {
    expect(hasLocation({ latitude: 0, longitude: 0 })).toBe(true);
    expect(hasLocation({ latitude: -90, longitude: 180 })).toBe(true);
    for (const coordinates of [{ latitude: NaN, longitude: 0 }, { latitude: 0, longitude: Infinity }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: null, longitude: 0 }])
      expect(hasLocation(coordinates)).toBe(false);
  });
});
