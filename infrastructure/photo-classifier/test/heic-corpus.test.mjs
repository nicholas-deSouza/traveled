import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpus, fetchFixture, loadFixture, parseArguments, rotateFixture, verifyFixture, verifyQuarterTurn } from './heic-corpus.mjs';

const bytes = Buffer.from('fixture');
const fixture = { name: 'test.heic', size: bytes.length,
  blob: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };

test('corpus pins small upstream crop, padding, rotation and auxiliary fixtures', () => {
  assert.equal(corpus.filter(f => f.crop).length, 2);
  assert.ok(corpus.some(f => f.alpha));
  for (const f of corpus) { assert.match(f.blob, /^[a-f0-9]{40}$/); assert.ok(f.size > 0 && f.size < 10_000); }
});
test('fixture identity is verified before decoding', () => {
  assert.equal(verifyFixture(bytes, fixture), bytes);
  assert.throws(() => verifyFixture(Buffer.from('changed'), fixture), /blob identity/);
  assert.throws(() => verifyFixture(Buffer.alloc(0), fixture), /byte length/);
});
test('offline corpus fails closed on missing files and preserves online identity checks', async () => {
  await assert.rejects(loadFixture(fixture, '/nonexistent/traveled-heic-corpus'), /ENOENT/);
  assert.deepEqual(await loadFixture(fixture, undefined, async () => new Response(bytes)), bytes);
  await assert.rejects(loadFixture(fixture, undefined, async () => new Response(Buffer.from('changed'))), /blob identity/);
});
test('offline files must match the pinned size and blob, with no network fallback', async () => {
  const file = fileURLToPath(import.meta.url); const input = await readFile(file);
  const local = { name: 'heic-corpus.test.mjs', size: input.length,
    blob: createHash('sha1').update(`blob ${input.length}\0`).update(input).digest('hex') };
  const unexpectedFetch = () => assert.fail('offline runs must not fetch');
  assert.deepEqual(await loadFixture(local, dirname(file), unexpectedFetch), input);
  await assert.rejects(loadFixture({ ...local, blob: '0'.repeat(40) }, dirname(file), unexpectedFetch), /blob identity/);
  await assert.rejects(loadFixture({ ...local, size: 1 }, dirname(file), unexpectedFetch), /byte length/);
});
test('strict crop, offline and browser bundle options cannot be silently ignored', () => {
  assert.deepEqual(parseArguments(['--require-crop', '/artifact', '--fixtures', '/public-corpus', '--browser-bundle']), {
    artifact: '/artifact', options: { requireCrop: true, browserBundle: true, fixtureDir: '/public-corpus' },
  });
  assert.deepEqual(parseArguments([]), { artifact: undefined, options: { requireCrop: true, browserBundle: false } });
  for (const args of [['--fixtures'], ['--fixtures', '--require-crop'], ['--require-crops'], ['/one', '/two']]) {
    assert.throws(() => parseArguments(args));
  }
});
test('quarter-turn checks tolerate chroma rounding but reject wrong pixels, alpha and dimensions', () => {
  const decoded = { width: 2, height: 1, rgba: Uint8ClampedArray.from([10, 20, 30, 255, 200, 210, 220, 128]) };
  const rotated = { width: 1, height: 2, rgba: Uint8ClampedArray.from([201, 210, 220, 128, 10, 19, 30, 255]) };
  verifyQuarterTurn(decoded, rotated);
  assert.throws(() => verifyQuarterTurn(decoded, { ...rotated, rgba: decoded.rgba }), /alpha/);
  assert.throws(() => verifyQuarterTurn(decoded, { ...rotated, width: 2 }), /strictly equal/);
  assert.throws(() => verifyQuarterTurn(decoded, { ...rotated, rgba: Uint8ClampedArray.from([10, 20, 30, 128, 200, 210, 220, 255]) }), /RGB correspondence/);
});
test('downloads fail closed on errors, oversized, truncated and changed bytes', async () => {
  assert.deepEqual(await fetchFixture(fixture, async url => {
    assert.match(url, /413e2a87e6a70b3eccc3a3adc5801179dd2d9e00/);
    return new Response(bytes);
  }), bytes);
  for (const response of [new Response('', { status: 404 }), new Response(Buffer.alloc(100)),
    new Response(Buffer.alloc(0)), new Response(Buffer.from('changed'))]) {
    await assert.rejects(fetchFixture(fixture, async () => response));
  }
});
test('rotation rejects unsupported or damaged fixture layouts', () => {
  assert.throws(() => rotateFixture(Buffer.from([0, 0, 0, 1, 0, 0, 0, 0])), /bounded/);
  assert.throws(() => rotateFixture(Buffer.alloc(0)), /meta required/);
});

test('rotation associates irot with the primary item and preserves absolute media offsets', () => {
  const box = (type, payload) => {
    const b = Buffer.alloc(payload.length + 8); b.writeUInt32BE(b.length); b.write(type, 4); payload.copy(b, 8); return b;
  };
  const pitm = box('pitm', Buffer.from([0, 0, 0, 0, 0, 7]));
  const ipco = box('ipco', box('ispe', Buffer.alloc(12)));
  const ipma = box('ipma', Buffer.from([0, 0, 0, 0, 0, 0, 0, 2, 0, 7, 1, 0x81, 0, 8, 1, 1]));
  const meta = box('meta', Buffer.concat([Buffer.alloc(4), pitm, box('iprp', Buffer.concat([ipco, ipma]))]));
  const mdat = box('mdat', Buffer.from('unchanged encoded pixels'));
  const original = Buffer.concat([meta, mdat]); const rotated = rotateFixture(original);
  assert.equal(rotated.toString('ascii', 4, 8), 'free');
  assert.deepEqual(rotated.subarray(meta.length, original.length), mdat);
  const appended = rotated.subarray(original.length);
  assert.equal(appended.readUInt32BE(0), appended.length);
  assert.equal(appended.toString('ascii', 4, 8), 'meta');
  const rotation = appended.indexOf('irot'); assert.ok(rotation > 0); assert.equal(appended[rotation + 4], 1);
  const associations = appended.indexOf('ipma');
  assert.deepEqual(appended.subarray(associations + 12), Buffer.from([0, 7, 2, 0x81, 0x82, 0, 8, 1, 1]));
  assert.deepEqual(original.subarray(0, meta.length), meta, 'input fixture is not mutated');
});
