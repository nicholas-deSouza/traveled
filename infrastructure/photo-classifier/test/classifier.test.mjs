import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createClassifier, providerOutcome, validateRequest, InvalidImage } from '../src/classifier.ts';
import { detectFormat, validateDimensions, validateInspection } from '../src/images.ts';

const bytes = new Uint8Array([1,2,3]);
const sha = createHash('sha256').update(bytes).digest('hex');
const id = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const request = { submission_id: id, stage: 'original', generation: 0, attempt_id: id, bucket: 'photo-quarantine', path: `${owner}/${id}/original`, expected_bytes: 3, expected_sha256: sha };
const result = (score = 0.1) => ({ status: 'success', nudity: { sexual_activity: score, sexual_display: 0.01, erotica: 0.01, suggestive: 1 } });
const deps = { download: async () => bytes, prepare: async bytes => ({ bytes, mime: 'image/jpeg' }), moderate: async () => ({ status: 200, body: result() }) };

test('required score thresholds are exact; suggestiveness does not reject', () => {
  for (const [score, expected] of [[0,'approved'],[0.199999,'approved'],[0.2,'uncertain'],[0.799999,'uncertain'],[0.8,'rejected'],[1,'rejected']]) {
    assert.equal(providerOutcome(200, result(score)).outcome, expected);
  }
  const display = result(); display.nudity.sexual_display = 0.8;
  assert.equal(providerOutcome(200, display).outcome, 'rejected');
  const erotica = result(); erotica.nudity.erotica = 0.2;
  assert.equal(providerOutcome(200, erotica).outcome, 'uncertain');
});
test('missing, malformed, out-of-range and error results never approve', () => {
  for (const score of [undefined, null, '0', Infinity, NaN, -1, 1.01]) { const body = result(); body.nudity.sexual_activity = score; assert.equal(providerOutcome(200, body).outcome, 'technical'); }
  for (const body of [null, {}, [], { nudity: result().nudity }, { status: 'failure', nudity: result().nudity }]) assert.equal(providerOutcome(200, body).outcome, 'technical');
  assert.equal(providerOutcome(500, result()).outcome, 'technical');
});
test('quota/rate limit pauses include a bounded server minimum without leaking provider errors', () => {
  assert.deepEqual(providerOutcome(429, {}, '123'), { outcome: 'quota', error: 'Moderation allowance unavailable', retry_after_seconds: 123 });
  assert.equal(providerOutcome(403, { status: 'failure', error: { message: 'daily limit exceeded secret stuff' } }).outcome, 'quota');
  assert.equal(providerOutcome(403, { status: 'failure', error: { message: 'invalid api secret' } }).outcome, 'technical');
  assert.equal(providerOutcome(429, {}, '999999999').retry_after_seconds, 999999999);
  const minimum = providerOutcome(429, {}, new Date(Date.now() + 120000).toUTCString()).retry_after_seconds;
  assert.ok(minimum >= 119 && minimum <= 120);
});
test('strict invocation identities reject arbitrary URLs, other objects and generation confusion', () => {
  assert.equal(validateRequest(request), request);
  assert.ok(validateRequest({ ...request, stage: 'candidate', generation: 2, path: `${owner}/${id}/candidate-2.webp` }));
  for (const patch of [{ path: 'https://example.com/a' }, { path: `${owner}/${id}/../original` }, { bucket: 'trip-photos' }, { generation: 1 }, { stage: 'candidate' }, { path: `${owner}/${id}/candidate-1Xwebp`, stage: 'candidate', generation: 1 }, { expected_bytes: 0 }, { expected_bytes: 21*1024*1024 }, { expected_sha256: 'oops' }, { attempt_id: 'x' }]) assert.throws(() => validateRequest({ ...request, ...patch }));
});
test('digest and length bind verdict to the exact source before provider preparation', async () => {
  let prepared = false;
  const classifier = createClassifier({ ...deps, prepare: async () => { prepared = true; throw Error(); } });
  const mismatch = await classifier({ ...request, expected_sha256: '0'.repeat(64) });
  assert.equal(mismatch.outcome, 'invalid'); assert.equal(mismatch.sha256, sha); assert.equal(prepared, false);
  assert.equal((await classifier({ ...request, expected_bytes: 4 })).outcome, 'invalid');
});
test('classification returns full identity and differentiates invalid bytes from technical failure', async () => {
  const approved = await createClassifier(deps)(request);
  assert.deepEqual(approved, { submission_id: id, stage: 'original', generation: 0, attempt_id: id, bytes: 3, sha256: sha, outcome: 'approved' });
  assert.equal((await createClassifier({ ...deps, prepare: async () => { throw new InvalidImage('Animated images are unsupported'); } })(request)).outcome, 'invalid');
  const failure = await createClassifier({ ...deps, moderate: async () => { throw Error('credential secret'); } })(request);
  assert.equal(failure.outcome, 'technical'); assert.equal(failure.error, 'Classification unavailable');
});
function pngChunk(type, data = Buffer.alloc(0)) { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length); b.write(type,4,'ascii'); data.copy(b,8); return b; }
const pngHeader = Buffer.from([137,80,78,71,13,10,26,10]);
function webpChunk(type, data) { const b = Buffer.alloc(8 + data.length + (data.length % 2)); b.write(type,0,'ascii'); b.writeUInt32LE(data.length,4); data.copy(b,8); return b; }
function webp(...chunks) { const b = Buffer.concat([Buffer.from('RIFF0000WEBP'), ...chunks]); b.writeUInt32LE(b.length-8,4); return b; }
function heic(brand, compatible = []) { const b = Buffer.alloc(16 + compatible.length*4); b.writeUInt32BE(b.length); b.write('ftyp',4); b.write(brand,8); compatible.forEach((v,i)=>b.write(v,16+i*4)); return b; }
test('actual container magic and animation markers override extensions and MIME', () => {
  assert.equal(detectFormat(Buffer.from([255,216,255,0,0,0,0,0,0,0,0,0])), 'jpeg');
  assert.equal(detectFormat(Buffer.concat([pngHeader,pngChunk('IEND')])), 'png');
  assert.throws(()=>detectFormat(Buffer.concat([pngHeader,pngChunk('acTL')])), /Animated/);
  assert.throws(()=>detectFormat(webp(webpChunk('ANMF',Buffer.alloc(2)))), /Animated/);
  assert.throws(()=>detectFormat(webp(webpChunk('VP8X',Buffer.from([2])))), /Animated/);
  assert.equal(detectFormat(webp(webpChunk('VP8 ',Buffer.alloc(2)))), 'webp');
  assert.throws(()=>detectFormat(Buffer.from('GIF89a000000')), /Supported/);
  assert.throws(()=>detectFormat(Buffer.from('<svg>example</svg>')), /Supported/);
});
test('HEIC still brands accepted while HEIC sequences and AVIF rejected', () => {
  assert.equal(detectFormat(heic('heic',['mif1'])), 'heic');
  assert.equal(detectFormat(heic('mif1',['heix'])), 'heic');
  assert.throws(()=>detectFormat(heic('heic',['msf1'])), /sequences/);
  assert.throws(()=>detectFormat(heic('hevc',['heic'])), /sequences/);
  assert.throws(()=>detectFormat(heic('avif',['mif1'])), /Supported/);
});
test('dimension and damaged container checks', () => {
  validateDimensions(10000,5000);
  for (const [w,h] of [[10000,5001],[undefined,10],[0,10],[1.5,2]]) assert.throws(()=>validateDimensions(w,h));
  const malformed = webp(webpChunk('VP8 ', Buffer.alloc(2))); malformed.writeUInt32LE(999,16);
  assert.throws(()=>detectFormat(malformed), /Damaged/);
  assert.throws(()=>detectFormat(Buffer.concat([pngHeader, Buffer.from([0,0,0,255,65,65,65,65,0,0,0,0])])), /Damaged/);
});

test('HEIC top-level count, dimensions, decode failure and context cleanup', async () => {
  const { decodeHeic } = await import('../src/images.ts');
  let freed = 0; let released = 0;
  const image = { get_width: () => 2, get_height: () => 1, free: () => freed++, display: (data, cb) => { data.data.set([1,2,3,255,4,5,6,255]); cb(data); } };
  const library = (images, ids = [1]) => ({ HeifDecoder: class { decoder = 123; decode() { return images; } }, heif_context_free: () => released++, heif_js_context_get_list_of_top_level_image_IDs: () => ids });
  const decoded = await decodeHeic(new Uint8Array(), library([image]));
  assert.equal(decoded.width,2); assert.equal(decoded.height,1); assert.equal(decoded.rgba.length,8);
  assert.equal(freed,1); assert.equal(released,1);
  await assert.rejects(decodeHeic(new Uint8Array(), library([image,image])), /one top-level/);
  await assert.rejects(decodeHeic(new Uint8Array(), library([image],[1,2])), /one top-level/);
  await assert.rejects(decodeHeic(new Uint8Array(), library([{ ...image, get_width: () => 10000, get_height: () => 5001 }])), /megapixel/);
  await assert.rejects(decodeHeic(new Uint8Array(), library([{ ...image, display: (_,cb) => cb(null) }])), /Damaged/);
  assert.equal(released,5);
});

 test('pre-download technical failures preserve the expected identity without approving it', async () => {
  const result = await createClassifier({ ...deps, download: async () => { throw Error('network'); } })(request);
  assert.equal(result.outcome,'technical'); assert.equal(result.sha256,sha); assert.equal(result.bytes,3);
});

test('Sightengine documented usage_limit machine type pauses independently of its message', () => {
  const response = { status: 'failure', error: { type: 'usage_limit', code: 123, message: 'Account allowance exhausted' } };
  const outcome = providerOutcome(403,response,'86400');
  assert.equal(outcome.outcome,'quota'); assert.equal(outcome.retry_after_seconds,86400);
  assert.equal(providerOutcome(403,{status:'failure',error:{type:'credentials_error',message:'Account credentials invalid'}}).outcome,'technical');
  assert.equal(providerOutcome(403,{status:'failure',error:{message:'Operations limit exceeded'}}).outcome,'quota');
});

test('gallery candidates enforce decoder-verified dimensions, still WebP and stripped EXIF/XMP', () => {
  const image = {format:'webp',width:2560,height:1440,pages:1};
  validateInspection(image,'webp','candidate');
  validateInspection({...image,width:10000,height:5000},'webp','original');
  for (const change of [{width:2561},{height:2561},{pages:2},{format:'png'},{exif:new Uint8Array([1])},{xmp:'GPS payload'}]) {
    assert.throws(()=>validateInspection({...image,...change},'webp','candidate'));
  }
  assert.throws(()=>validateInspection({...image,format:'png'},'png','candidate'),/WebP/);
  // Original metadata is allowed so GPS can be extracted after its authoritative check.
  validateInspection({...image,exif:new Uint8Array([1]),xmp:'GPS payload'},'webp','original');
});
test('WebP candidate container metadata cannot hide behind missing decoder metadata; ICC remains harmless', () => {
  for (const type of ['EXIF','XMP ']) {
    const bytes = webp(webpChunk(type,Buffer.from([1,2])));
    assert.equal(detectFormat(bytes,'original'),'webp');
    assert.throws(()=>detectFormat(bytes,'candidate'),/EXIF or XMP/);
  }
  for (const flag of [4,8,12]) assert.throws(()=>detectFormat(webp(webpChunk('VP8X',Buffer.from([flag]))),'candidate'),/EXIF or XMP/);
  assert.equal(detectFormat(webp(webpChunk('VP8X',Buffer.from([32])),webpChunk('ICCP',Buffer.from([1,2]))),'candidate'),'webp');
});
test('candidate byte cap and still-format guards execute before any native decode or provider call', async () => {
  const { prepareImage } = await import('../src/images.ts');
  await assert.rejects(prepareImage(new Uint8Array(8*1024*1024+1),'candidate'),/byte limit/);
  await assert.rejects(prepareImage(new Uint8Array(20*1024*1024+1),'original'),/byte limit/);
  await assert.rejects(prepareImage(Buffer.concat([pngHeader,pngChunk('IEND')]),'candidate'),/still WebP/);
  await assert.rejects(prepareImage(webp(webpChunk('ANIM',Buffer.alloc(2))),'candidate'),/Animated/);
});
