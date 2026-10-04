import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createDiagnostics, fail, isMain, runScript } from '../../../scripts/script-diagnostics.mjs';
import { vendorSource, verifyVendor } from '../stage-vendor.mjs';

export async function smokeArtifact(artifact, fixture, diagnostics = createDiagnostics('classifier-artifact-smoke')) {
let stage = 'load-codecs';
const mark = value => { stage = value; diagnostics.event(stage, 'started'); };
try {
mark(stage);
const require = createRequire(artifact ? join(resolve(artifact), 'package.json') : import.meta.url);
const sharp = require('sharp');
const { prepareImage } = await import(artifact ? pathToFileURL(join(resolve(artifact),'infrastructure/photo-classifier/src/images.js')).href : '../src/images.ts');
mark('still-image-formats');
for (const format of ['jpeg','png','webp']) {
  const input = await sharp({ create: { width: 32,height: 16,channels: 3,background: '#85a76b' } })[format]().toBuffer();
  const output = await prepareImage(input,format === 'webp' ? 'candidate' : 'original');
  assert.equal(output.mime,`image/${format}`);
  assert.deepEqual(output.bytes,input);
}
// Orientation is retained for temporary JPEGs while EXIF/GPS is discarded. Generate a >8 MiB
// valid PNG by appending a large ancillary chunk before IEND; pixel decoding still verifies it.
const base = await sharp({ create: { width: 32,height: 16,channels: 3,background: '#85a76b' } }).png().toBuffer();
const payload = Buffer.alloc(8*1024*1024,17);
function crc32(bytes) { let crc=0xffffffff; for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0; }
const chunk = Buffer.alloc(payload.length+12); chunk.writeUInt32BE(payload.length); chunk.write('tEXt',4); payload.copy(chunk,8); chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);
const oversized = Buffer.concat([base.subarray(0,-12),chunk,base.subarray(-12)]);
mark('oversized-source-conversion');
const temporary = await prepareImage(oversized,'original');
assert.equal(temporary.mime,'image/jpeg'); assert.ok(temporary.bytes.length<=8*1024*1024);
const metadata = await sharp(temporary.bytes).metadata(); assert.equal(metadata.width,32); assert.equal(metadata.height,16); assert.equal(metadata.exif,undefined);
// HEIC fixtures are checked when supplied by release CI. No live photos, credentials or API calls.
if (fixture) {
  mark('heic-fixture');
  const decoded = await prepareImage(await readFile(fixture),'original');
  assert.equal(decoded.mime,'image/jpeg');
  const metadata = await sharp(decoded.bytes).metadata();
  assert.ok(metadata.width>0 && metadata.height>0 && Math.max(metadata.width,metadata.height)<=2560);
} else {
  mark('heic-wasm');
  // Initialize the shipped WASM even without a HEIC corpus, exercising packaging and dynamic loading.
  const root = artifact ? join(resolve(artifact), 'vendor/libheif-1.23.5') : vendorSource;
  await verifyVendor(root);
  const factory = require(join(root,'libheif.cjs'));
  const lib = await factory({wasmBinary:await readFile(join(root,'libheif.wasm'))});
  assert.equal(lib.heif_get_version(), '1.23.5');
  assert.equal(typeof lib.HeifDecoder,'function');
  assert.deepEqual(new lib.HeifDecoder().decode(new Uint8Array([1,2,3])),[]);
}
console.log('Classifier artifact native/WASM smoke passed');
diagnostics.event('native-smoke', 'completed');
} catch {
  throw fail(stage, 'native_smoke_failed', 'Classifier native/WASM smoke failed. Check codec packaging, decoded image format, dimensions and metadata for this stage.');
}
}

if (isMain(import.meta.url)) await runScript('classifier-artifact-smoke', diagnostics => smokeArtifact(process.argv[2], process.argv[3], diagnostics));
