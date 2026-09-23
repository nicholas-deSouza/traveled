import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(name, dependencies = {}, globals = {}) {
  const source = readFileSync(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; }, ...globals });
  return exports;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
const noLocation = { latitude: null, longitude: null };
const metadata = load('photoMetadata', { exifr: {} });

test('GPS extraction preserves zero and rejects incomplete or invalid pairs without blocking uploads', async () => {
  for (const input of [{ latitude: 0, longitude: 0 }, { latitude: -90, longitude: 180 }]) {
    const api = load('photoMetadata', { exifr: { gps: async () => input } });
    assert.deepEqual(plain(await api.extractLocation({})), input);
  }
  for (const input of [undefined, {}, { latitude: 20 }, { latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: '1', longitude: 2 }]) {
    const api = load('photoMetadata', { exifr: { gps: async () => input } });
    assert.deepEqual(plain(await api.extractLocation({})), noLocation);
  }
  const api = load('photoMetadata', { exifr: { gps: async () => { throw new Error('Malformed EXIF'); } } });
  assert.deepEqual(plain(await api.extractLocation({})), noLocation);
});

test('color defaults are stable, custom colors win, and invalid colors use the palette', () => {
  const { tripColor } = load('tripColor');
  assert.equal(tripColor({ id: 'trip' }), tripColor({ id: 'trip', color: null }));
  assert.equal(tripColor({ id: 'trip', color: '#00aB12' }), '#00aB12');
  assert.equal(tripColor({ id: 'trip', color: 'red' }), tripColor({ id: 'trip' }));
  assert.ok(new Set(['one', 'two', 'three', 'four'].map(id => tripColor({ id }))).size > 1);
});

test('exact coordinates remain grouped with a stable representative, excluding unlocated photos', () => {
  const { photoPoints } = load('globeData', { './photoMetadata': metadata });
  const photos = [{ id: 'b', latitude: 1, longitude: 2 }, { id: 'a', latitude: 1, longitude: 2 }, { id: 'c', ...noLocation }];
  const result = photoPoints(photos);
  assert.equal(result.data.features.length, 1);
  assert.equal(result.data.features[0].properties.count, 2);
  assert.equal(result.photos[result.data.features[0].properties.representative].id, 'a');
  assert.deepEqual(plain(result), plain(photoPoints([...photos].reverse())));
});

test('overlapping markers receive stable non-overlapping offsets', () => {
  const { markerOffsets } = load('globeData', { './photoMetadata': metadata });
  const points = Array.from({ length: 10 }, (_, i) => ({ id: `trip-${i}`, x: 200, y: 200 }));
  const offsets = markerOffsets(points);
  assert.equal(JSON.stringify([...offsets]), JSON.stringify([...markerOffsets([...points].reverse())]));
  const values = [...offsets.values()];
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
    assert.ok(Math.abs(values[i][0] - values[j][0]) >= 76 || Math.abs(values[i][1] - values[j][1]) >= 76);
  }
});

function dataApi(db, extractLocation = async () => noLocation) {
  return load('groups', { './supabase': { supabase: db }, './photoMetadata': { extractLocation } }, { crypto: { randomUUID: () => 'file-id' } });
}

test('atlas loads beyond 500 rows, keeps empty trips, and excludes orphaned or inaccessible trips', async () => {
  const photos = Array.from({ length: 1001 }, (_, id) => ({ id: String(id), trip_id: 'trip', ...noLocation }));
  const dataset = {
    photos: [...photos, { id: 'hidden-photo', trip_id: 'hidden' }],
    trips: [{ id: 'trip', group_id: 'group', created_at: '2026-01-01' }, { id: 'empty', group_id: 'group', created_at: '2026-02-01' }, { id: 'hidden', group_id: 'missing', created_at: '2026-03-01' }],
    groups: [{ id: 'group', name: 'Friends' }],
  };
  const ranges = [];
  const db = { from(table) { return { select() { return this; }, order() { return this; }, range(start, end) { ranges.push([table, start, end]); return { data: dataset[table].slice(start, end + 1), error: null }; } }; } };
  const result = await dataApi(db).loadAtlas();
  assert.equal(result.photos.length, 1001);
  assert.deepEqual(plain(result.trips.map(trip => [trip.id, trip.photoCount, trip.groupName])), [['empty', 0, 'Friends'], ['trip', 1001, 'Friends']]);
  assert.equal(ranges.filter(([table]) => table === 'photos').length, 3);
});

test('color update reports RLS zero-row results and rejects invalid colors before writing', async () => {
  let calls = 0;
  const api = dataApi({ from() { calls++; return { update() { return this; }, eq() { return this; }, select() { return this; }, single() { return { data: null, error: null }; } }; } });
  await assert.rejects(api.updateTripColor('trip', 'red'), /valid/);
  assert.equal(calls, 0);
  await assert.rejects(api.updateTripColor('trip', '#123456'), /could not be updated/);
});

test('uploads persist extracted coordinates and clean up storage on metadata insertion failure', async () => {
  let inserted, removed = 0;
  const db = { from() { return { insert(value) { inserted = value; return { error: new Error('Insert denied') }; } }; }, storage: { from() { return { upload: async () => ({ error: null }), remove: async () => { removed++; return { error: null }; } }; } } };
  const api = dataApi(db, async () => ({ latitude: 0, longitude: -73 }));
  await assert.rejects(api.uploadPhoto({ id: 'trip', group_id: 'group' }, 'member', { type: 'image/jpeg', size: 100 }), /Insert denied/);
  assert.equal(inserted.latitude, 0); assert.equal(inserted.longitude, -73); assert.equal(removed, 1);
});

function deletionFixture({ owner = 'me', storageError = null, rows = [{ id: 'photo' }] } = {}) {
  const calls = [];
  const db = { auth: { getUser: async () => ({ data: { user: { id: 'me' } }, error: null }) }, from() { return {
    select() { return this; }, eq() { return this; }, single() { return { data: { id: 'photo', uploaded_by: owner, storage_path: 'canonical/path' }, error: null }; },
    delete() { calls.push('record'); return { eq() { return this; }, select() { return this; }, single() { return { data: rows[0] ?? null, error: null }; } }; },
  }; }, storage: { from() { return { remove: async paths => { calls.push(paths[0]); return { data: [{ name: 'canonical/path' }], error: storageError }; } }; } } };
  return { api: dataApi(db), calls };
}

test('deletion checks owner and removes canonical storage object before record', async () => {
  const denied = deletionFixture({ owner: 'other' });
  await assert.rejects(denied.api.deletePhoto('photo'), /Only the uploader/);
  assert.deepEqual(denied.calls, []);
  const allowed = deletionFixture(); await allowed.api.deletePhoto('photo');
  assert.deepEqual(allowed.calls, ['canonical/path', 'record']);
});

test('deletion preserves record on storage errors, handles missing files, and reports partial failures', async () => {
  const failed = deletionFixture({ storageError: new Error('Offline') });
  await assert.rejects(failed.api.deletePhoto('photo'), /Offline/); assert.equal(failed.calls.length, 1);
  const retry = deletionFixture({ storageError: { code: 'ObjectNotFound' } });
  await retry.api.deletePhoto('photo'); assert.equal(retry.calls.length, 2);
  const partial = deletionFixture({ rows: [] });
  await assert.rejects(partial.api.deletePhoto('photo'), /Retry to finish cleanup/);
});

test('thumbnail downloads are bounded and stale results never allocate private URLs', async () => {
  const pending = [], allocated = [], revoked = [], received = [];
  const { thumbnailCache } = load('thumbnailCache', {}, { URL: { createObjectURL(blob) { allocated.push(blob); return `blob:${blob}`; }, revokeObjectURL(url) { revoked.push(url); } } });
  const cache = thumbnailCache(path => new Promise(resolve => pending.push({ path, resolve })), 2);
  cache.setVisible(new Map(['a', 'b', 'c'].map(path => [path, url => received.push(url)])));
  assert.equal(pending.length, 2);
  cache.setVisible(new Map([['c', url => received.push(url)]]));
  pending[0].resolve('a'); pending[1].resolve('b'); await tick();
  assert.deepEqual(allocated, []); assert.equal(pending.length, 3);
  pending[2].resolve('c'); await tick();
  assert.deepEqual(allocated, ['c']); assert.ok(received.includes('blob:c'));
  cache.dispose(); assert.deepEqual(revoked, ['blob:c']);
});

test('thumbnail disposal during a download ignores its eventual result', async () => {
  let resolve;
  const { thumbnailCache } = load('thumbnailCache', {}, { URL: { createObjectURL() { throw new Error('Should not allocate'); } } });
  const cache = thumbnailCache(() => new Promise(done => { resolve = done; }));
  cache.setVisible(new Map([['photo', () => assert.fail('stale callback')]]));
  cache.dispose(); resolve('blob'); await tick();
});

test('auth returns home by default, preserves trip destinations, and rejects external redirects', () => {
  const { authDestination } = load('authRedirect', {}, { URL, window: { location: { origin: 'https://traveled.test' } } });
  assert.equal(authDestination(null), '/'); assert.equal(authDestination('/'), '/');
  assert.equal(authDestination('/trips/abc-123'), '/trips/abc-123');
  assert.equal(authDestination('/join#token'), '/join#token');
  assert.equal(authDestination('https://evil.test/trips/abc'), '/');
});

test('the installed EXIF reader extracts signed GPS from a real JPEG EXIF segment', async () => {
  const { default: exifr } = await import('exifr');
  const tiff = Buffer.alloc(128);
  tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10); tiff.writeUInt16LE(4, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(4, 26);
  const entry = (offset, tag, type, count, value) => {
    tiff.writeUInt16LE(tag, offset); tiff.writeUInt16LE(type, offset + 2); tiff.writeUInt32LE(count, offset + 4); tiff.writeUInt32LE(value, offset + 8);
  };
  entry(28, 1, 2, 2, 78); entry(40, 2, 5, 3, 80);
  entry(52, 3, 2, 2, 87); entry(64, 4, 5, 3, 104);
  [37, 30, 0, 122, 15, 0].forEach((value, i) => { tiff.writeUInt32LE(value, 80 + i * 8); tiff.writeUInt32LE(1, 84 + i * 8); });
  const segment = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]); header.writeUInt16BE(segment.length + 2, 4);
  const jpeg = Buffer.concat([header, segment, Buffer.from([0xff, 0xd9])]);
  const api = load('photoMetadata', { exifr });
  assert.deepEqual(plain(await api.extractLocation(jpeg)), { latitude: 37.5, longitude: -122.25 });
});
