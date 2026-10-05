import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the real data layer with a fake client; never load Supabase or .env.
const source = readFileSync(new URL('../src/lib/groups.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const rows = Array.from({ length: 9 }, (_, index) => ({ id: `photo-${index}`, storage_path: `photo-${index}.jpg`, uploaded_by: 'member' }));

function fixture({ download = async path => ({ data: { path }, error: null }), photosError = null, photoRows = rows } = {}) {
  const calls = { downloads: [], ranges: [], orders: [], revoked: [], tables: [] };
  const db = {
    from(table) {
      calls.tables.push(table);
      return {
        select() { return this; }, eq() { return this; },
        order(...args) { calls.orders.push(args); return this; },
        range(...args) { calls.ranges.push(args); return Promise.resolve({ data: photoRows, error: photosError }); },
        single() { return Promise.resolve({ data: table === 'trips' ? { id: 'trip', group_id: 'group', title: 'A trip' } : { id: 'group', name: 'Friends' }, error: null }); },
      };
    },
    storage: { from() { return { download(path) { calls.downloads.push(path); return download(path); } }; } },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) { if (name === './photoMetadata') return {}; assert.equal(name, './supabase'); return { supabase: db }; },
    URL: { createObjectURL: blob => `blob:${blob.path}`, revokeObjectURL: url => calls.revoked.push(url) },
  });
  return { api: exports, calls };
}

test('trip metadata renders without querying or downloading photos', async () => {
  const { api, calls } = fixture();
  const data = await api.loadTrip('trip');
  assert.equal(data.trip.title, 'A trip');
  assert.equal(data.group.name, 'Friends');
  assert.deepEqual(calls.tables, ['trips', 'groups']);
  assert.equal(calls.downloads.length, 0);
});

test('missing objects and rejected downloads do not discard valid photos', async () => {
  const { api } = fixture({ download: async path => {
    if (path === 'photo-0.jpg') return { data: null, error: { message: 'Object not found' } };
    if (path === 'photo-1.jpg') throw new Error('Network interrupted');
    return { data: { path }, error: null };
  } });
  const data = await api.loadTripPhotos('trip');
  assert.equal(data.photos.length, 8);
  assert.equal(data.photos[0].url, null);
  assert.equal(data.photos[1].url, null);
  assert.equal(data.photos[2].url, 'blob:photo-2.jpg');
  assert.equal(data.hasMore, true);
});

test('downloads run concurrently but only for the requested page', async () => {
  const pending = [];
  const { api, calls } = fixture({ download: path => new Promise(resolve => pending.push(() => resolve({ data: { path }, error: null }))) });
  const request = api.loadTripPhotos('trip', 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 8);
  assert.equal(calls.downloads.includes('photo-8.jpg'), false);
  assert.deepEqual(calls.ranges, [[16, 24]]);
  assert.deepEqual(calls.orders.map(order => order[0]), ['created_at', 'id']);
  pending.forEach(resolve => resolve());
  assert.equal((await request).photos.length, 8);
});

test('page disposal revokes only allocated image URLs', async () => {
  const { api, calls } = fixture({ download: async path => path === 'photo-0.jpg' ? { data: null, error: null } : { data: { path }, error: null } });
  const data = await api.loadTripPhotos('trip');
  api.releasePhotos(data.photos);
  assert.equal(calls.revoked.length, 7);
  assert.equal(calls.revoked.includes(null), false);
});

test('metadata errors fail the gallery without starting downloads', async () => {
  const { api, calls } = fixture({ photosError: new Error('Access denied') });
  await assert.rejects(api.loadTripPhotos('trip'), /Access denied/);
  assert.equal(calls.downloads.length, 0);
});

test('invalid pages are rejected before querying', async () => {
  const { api, calls } = fixture();
  for (const page of [-1, 0.5, NaN, Infinity]) await assert.rejects(api.loadTripPhotos('trip', page), /Invalid photo page/);
  assert.equal(calls.tables.length, 0);
});

function deletionFixture({ error = null, data = {} } = {}) {
  const calls = [];
  const db = { functions: { invoke: async (name, options) => {
    calls.push([name, options.body]); return { data, error };
  } } };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: () => ({ supabase: db }) });
  return { api: exports, calls };
}

test('deletion uses authenticated trusted API with only photo identity', async () => {
  const { api, calls } = deletionFixture();
  await api.deletePhoto('photo');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['photo-upload', { action: 'delete', id: 'photo' }]]);
});

test('deletion failures remain visible and can retry the same identity', async () => {
  for (const options of [{ error: new Error('Access denied') }, { data: { error: 'Access denied' } }]) {
    const { api, calls } = deletionFixture(options);
    await assert.rejects(api.deletePhoto('photo'), /Access denied/);
    assert.equal(calls.length, 1);
  }
});

test('refresh after deletion reuses remaining images and downloads only the next photo', async () => {
  const initial = fixture();
  const first = await initial.api.loadTripPhotos('trip');
  const afterDeletion = fixture({ photoRows: rows.slice(1) });
  const refreshed = await afterDeletion.api.loadTripPhotos('trip', 0, first.photos.slice(1));
  assert.deepEqual(afterDeletion.calls.downloads, ['photo-8.jpg']);
  assert.equal(refreshed.photos[0].url, first.photos[1].url);
  assert.equal(refreshed.photos.length, 8);
  assert.equal(refreshed.hasMore, false);
});

test('cached images do not skip metadata authorization checks', async () => {
  const initial = fixture();
  const first = await initial.api.loadTripPhotos('trip');
  const denied = fixture({ photosError: new Error('Access denied') });
  await assert.rejects(denied.api.loadTripPhotos('trip', 0, first.photos), /Access denied/);
  assert.equal(denied.calls.downloads.length, 0);
});

test('refresh retries unavailable images and replaces changed storage paths', async () => {
  const previous = rows.slice(0, 8).map(row => ({ ...row, url: `cached:${row.id}` }));
  previous[0].url = null;
  previous[1].storage_path = 'old-path.jpg';
  const { api, calls } = fixture();
  const data = await api.loadTripPhotos('trip', 0, previous);
  assert.deepEqual(calls.downloads, ['photo-0.jpg', 'photo-1.jpg']);
  assert.equal(data.photos[2].url, 'cached:photo-2');
});

function locationFixture(error = null) {
  const calls = [], events = [];
  const exports = {};
  const db = { rpc: async (name, args) => { calls.push([name, args]); return { error }; } };
  vm.runInNewContext(compiled, {
    exports, require: () => ({ supabase: db }),
    window: { dispatchEvent: event => events.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  return { api: exports, calls, events };
}

test('manual locations use one atomic metadata RPC and notify gallery/atlas only after success', async () => {
  const { api, calls, events } = locationFixture();
  await api.updatePhotoLocations('trip', ['one', 'two'], { latitude: 0, longitude: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['set_photo_locations', {
    target_trip_id: 'trip', photo_ids: ['one', 'two'], location_latitude: 0, location_longitude: 0,
  }]]);
  assert.equal(events[0].type, 'traveled:photo-changed');
  assert.equal(events[0].detail.tripId, 'trip');
});

test('manual location failures surface without emitting a success event or calling upload APIs', async () => {
  const { api, calls, events } = locationFixture(new Error('Access denied'));
  await assert.rejects(api.updatePhotoLocations('trip', ['one'], { latitude: 10, longitude: 20 }), /Access denied/);
  assert.equal(calls.length, 1);
  assert.equal(events.length, 0);
});

test('invalid manual location selections and coordinates fail before requesting changes', async () => {
  const { api, calls } = locationFixture();
  for (const ids of [[], ['one', 'one'], Array.from({ length: 101 }, (_, index) => String(index))])
    await assert.rejects(api.updatePhotoLocations('trip', ids, { latitude: 0, longitude: 0 }), /Select/);
  for (const location of [{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: NaN, longitude: 0 }, { latitude: null, longitude: 0 }])
    await assert.rejects(api.updatePhotoLocations('trip', ['one'], location), /valid photo location/);
  assert.equal(calls.length, 0);
});
