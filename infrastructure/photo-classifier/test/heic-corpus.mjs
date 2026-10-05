import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import { vendorSource, verifyVendor } from '../stage-vendor.mjs';

// Public libheif regression images, pinned to its v1.23.5 source tree. No camera uploads.
// Upstream redistribution terms: https://github.com/strukturag/libheif/blob/v1.23.5/COPYING
export const revision = '413e2a87e6a70b3eccc3a3adc5801179dd2d9e00';
export const corpus = [
  { name: 'rainbow-451x461.heic', size: 7080, blob: '6691f50f39bd69871a2abe284de2ef9f5243bc66', width: 451, height: 461 },
  { name: 'with-alpha-512x512.heic', size: 8284, blob: '897d470339a3f4ceeff5155e981bbefceea9f648', width: 512, height: 512, alpha: true },
  { name: 'clap_cropped.heic', size: 2060, blob: 'af1852bb082591efa0fdd858839ebd88ed38940f', width: 64, height: 64, crop: true },
  { name: 'conformance_window_padding.heic', size: 656, blob: '3daf5681e22df6ef719aad549d75ce27907a0ecf', width: 1, height: 1, crop: true },
];

export function verifyFixture(bytes, fixture) {
  assert.equal(bytes.length, fixture.size, `${fixture.name}: byte length`);
  // Match Git's content-addressed blob identity, including its header, before decoding.
  const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  assert.equal(hash, fixture.blob, `${fixture.name}: upstream blob identity`);
  return bytes;
}

export async function fetchFixture(fixture, request = fetch) {
  const response = await request(`https://raw.githubusercontent.com/strukturag/libheif/${revision}/tests/data/${fixture.name}`,
    { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, 200, `${fixture.name}: download failed`);
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    assert.ok(length <= fixture.size, `${fixture.name}: download exceeds pinned length`);
    chunks.push(chunk);
  }
  return verifyFixture(Buffer.concat(chunks), fixture);
}

// Offline runs accept only the same reviewed public bytes, never arbitrary camera files.
export async function loadFixture(fixture, fixtureDir, request = fetch) {
  return fixtureDir
    ? verifyFixture(await readFile(join(resolve(fixtureDir), fixture.name)), fixture)
    : fetchFixture(fixture, request);
}

export function parseArguments(args) {
  const options = { requireCrop: true, browserBundle: false };
  let artifact;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--require-crop') options.requireCrop = true;
    else if (arg === '--browser-bundle') options.browserBundle = true;
    else if (arg === '--fixtures') {
      assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), '--fixtures requires a directory');
      options.fixtureDir = args[++i];
    } else {
      assert.ok(!arg.startsWith('--') && artifact === undefined, `Unexpected argument: ${arg}`);
      artifact = arg;
    }
  }
  return { artifact, options };
}

function boxes(bytes, offset = 0) {
  const result = [];
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset);
    assert.ok(size >= 8 && offset + size <= bytes.length, 'fixture must use bounded 32-bit boxes');
    result.push({ type: bytes.toString('ascii', offset + 4, offset + 8), bytes: bytes.subarray(offset, offset + size), offset });
    offset += size;
  }
  return result;
}
function box(type, payload) {
  const result = Buffer.alloc(payload.length + 8);
  result.writeUInt32BE(result.length); result.write(type, 4); payload.copy(result, 8);
  return result;
}

/** Add a real HEIF quarter-turn property to the primary item without re-encoding pixels.
 * Move meta to the end and turn the old meta into free: absolute iloc offsets stay valid.
 * Only the reviewed corpus's 16-bit item-ID/ipma layout is supported.
 */
export function rotateFixture(input) {
  const top = boxes(input); const meta = top.find(b => b.type === 'meta');
  assert.ok(meta, 'meta required');
  const children = boxes(meta.bytes, 12);
  const pitm = children.find(b => b.type === 'pitm').bytes;
  assert.equal(pitm[8], 0, '16-bit primary ID required');
  const primary = pitm.readUInt16BE(12);
  const iprp = children.find(b => b.type === 'iprp'); const properties = boxes(iprp.bytes, 8);
  const ipco = properties.find(b => b.type === 'ipco'); const entries = boxes(ipco.bytes, 8);
  assert.ok(!entries.some(b => b.type === 'irot'), 'fixture must start unrotated');
  const index = entries.length + 1; assert.ok(index < 128);
  const ipma = Buffer.from(properties.find(b => b.type === 'ipma').bytes);
  assert.equal(ipma.readUInt32BE(8), 0, 'ipma version 0 and 8-bit associations required');
  let offset = 16; let insertion;
  for (let i = 0; i < ipma.readUInt32BE(12); i++) {
    const id = ipma.readUInt16BE(offset); const count = ipma[offset + 2];
    if (id === primary) { assert.ok(count < 255); ipma[offset + 2]++; insertion = offset + 3 + count; }
    offset += 3 + count;
  }
  assert.notEqual(insertion, undefined, 'primary associations required');
  const rotatedIpma = box('ipma', Buffer.concat([ipma.subarray(8, insertion), Buffer.from([0x80 | index]), ipma.subarray(insertion)]));
  const rotatedIpco = box('ipco', Buffer.concat([ipco.bytes.subarray(8), box('irot', Buffer.from([1]))]));
  const rotatedIprp = box('iprp', Buffer.concat(properties.map(b => b.type === 'ipma' ? rotatedIpma : b.type === 'ipco' ? rotatedIpco : b.bytes)));
  const rotatedMeta = box('meta', Buffer.concat([meta.bytes.subarray(8, 12), ...children.map(b => b.type === 'iprp' ? rotatedIprp : b.bytes)]));
  const original = Buffer.from(input); original.write('free', meta.offset + 4);
  return Buffer.concat([original, rotatedMeta]);
}

export function verifyQuarterTurn(decoded, rotated) {
  assert.equal(rotated.width, decoded.height); assert.equal(rotated.height, decoded.width);
  let rgbError = 0;
  for (let y = 0; y < decoded.height; y++) for (let x = 0; x < decoded.width; x++) {
    const source = (y * decoded.width + x) * 4;
    const target = ((decoded.width - 1 - x) * rotated.width + y) * 4;
    assert.equal(rotated.rgba[target + 3], decoded.rgba[source + 3], 'rotated alpha');
    for (let channel = 0; channel < 3; channel++) {
      rgbError += Math.abs(rotated.rgba[target + channel] - decoded.rgba[source + channel]);
    }
  }
  // HEVC chroma upsampling after rotation can differ at colour edges. The public
  // rainbow fixture measured 0.169 mean RGB levels with 1.23.2; allow at most one
  // level out of 255, while still verifying spatial correspondence and exact alpha.
  assert.ok(rgbError / (decoded.width * decoded.height * 3) <= 1, 'quarter-turn RGB correspondence');
}

export async function smokeHeicCorpus(artifact, { fixtureDir, browserBundle = false } = {}) {
  const require = createRequire(artifact ? join(resolve(artifact), 'package.json') : import.meta.url);
  const root = artifact ? join(resolve(artifact), 'vendor/libheif-1.23.5') : vendorSource;
  await verifyVendor(root);
  let initialize;
  if (browserBundle) {
    // Run the exact unmodified factory in a worker-like realm: no process,
    // require, filesystem or network. This exercises its browser code path.
    const module = { exports: {} };
    const browser = await readFile(join(root, 'libheif-browser.mjs'), 'utf8');
    assert.ok(browser.includes('export default libheif;'));
    runInNewContext(browser.replace('export default libheif;', ''), {
      module, exports: module.exports, WebAssembly, console, TextDecoder, TextEncoder,
      Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
      Float32Array, Float64Array, BigInt64Array, BigUint64Array, ArrayBuffer, DataView,
      setTimeout, clearTimeout, performance, atob,
      self: { location: { href: 'https://offline.invalid/libheif.cjs' } },
      importScripts: () => assert.fail('Unexpected worker script request'),
      fetch: () => assert.fail('Unexpected worker network request'),
    });
    initialize = module.exports;
  } else initialize = require(join(root, 'libheif.cjs'));
  const lib = await initialize({ wasmBinary: await readFile(join(root, 'libheif.wasm')) });
  const { decodeHeic, prepareImage } = await import(artifact
    ? pathToFileURL(join(resolve(artifact), 'infrastructure/photo-classifier/src/images.js')).href : '../src/images.ts');
  const sharp = require('sharp'); const version = lib.heif_get_version();
  assert.equal(version, '1.23.5', 'Pinned decoder runtime version');
  console.log(`HEIC decoder: libheif ${version}, ${browserBundle ? 'browser worker realm' : 'classifier WASM'}, crop required`);
  for (const fixture of corpus) {
    const bytes = await loadFixture(fixture, fixtureDir);
    const decoded = await decodeHeic(bytes, lib);
    assert.equal(decoded.width, fixture.width); assert.equal(decoded.height, fixture.height);
    assert.equal(decoded.rgba.length, fixture.width * fixture.height * 4);
    if (fixture.alpha) assert.ok(decoded.rgba.some((value, i) => i % 4 === 3 && value < 255), 'auxiliary alpha must be decoded');
    const prepared = await prepareImage(bytes, 'original'); assert.equal(prepared.mime, 'image/jpeg');
    const metadata = await sharp(prepared.bytes).metadata();
    assert.equal(metadata.width, fixture.width); assert.equal(metadata.height, fixture.height);
    assert.equal(metadata.exif, undefined); assert.equal(metadata.xmp, undefined);
    if (fixture.name.startsWith('rainbow')) {
      const rotated = await decodeHeic(rotateFixture(bytes), lib);
      verifyQuarterTurn(decoded, rotated);
    }
    console.log(`HEIC corpus passed: ${fixture.name}, libheif ${version}`);
  }
  return { version, blocked: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { artifact, options } = parseArguments(process.argv.slice(2));
  await smokeHeicCorpus(artifact, options);
}
