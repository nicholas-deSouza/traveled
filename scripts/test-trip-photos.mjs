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
    require(name) { assert.equal(name, './supabase'); return { supabase: db }; },
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

function deletionFixture({ owner = 'member', storageError = null, metadataError = null, deleted = { id: 'photo' }, removed = [{ name: 'group/trip/photo.jpg' }], exists = false, existsError = null } = {}) {
  const calls = [];
  let deleting = false;
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: 'member' } }, error: null }) },
    from(table) {
      assert.equal(table, 'photos');
      return {
        select() { return this; },
        eq(key, value) { calls.push(['filter', key, value]); return this; },
        delete() { deleting = true; calls.push('metadata'); return this; },
        single: async () => deleting
          ? { data: deleted, error: metadataError }
          : { data: { id: 'photo', storage_path: 'group/trip/photo.jpg', uploaded_by: owner }, error: null },
      };
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'trip-photos');
      return { exists: async () => ({ data: exists, error: existsError }), remove: async paths => { calls.push(['storage', ...paths]); return { data: removed, error: storageError }; } };
    } },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: () => ({ supabase: db }) });
  return { api: exports, calls };
}

test('deletion removes the trusted file before uploader-filtered metadata', async () => {
  const { api, calls } = deletionFixture();
  await api.deletePhoto('photo');
  assert.deepEqual(calls, [
    ['filter', 'id', 'photo'], ['storage', 'group/trip/photo.jpg'],
    'metadata', ['filter', 'id', 'photo'], ['filter', 'uploaded_by', 'member'],
  ]);
});

test('storage failure preserves metadata', async () => {
  const { api, calls } = deletionFixture({ storageError: { message: 'Storage denied', code: 'AccessDenied' } });
  await assert.rejects(api.deletePhoto('photo'), { message: 'Storage denied' });
  assert.equal(calls.includes('metadata'), false);
});

test('metadata failure reports partial deletion and a retry', async () => {
  const { api } = deletionFixture({ metadataError: { message: 'Network failure' } });
  await assert.rejects(api.deletePhoto('photo'), /file was removed.*Retry to finish cleanup.*Network failure/);
});

test('retry cleans metadata when storage file is absent', async () => {
  for (const options of [{ removed: [] }, { storageError: { code: 'NoSuchKey' } }, { storageError: { code: 'ObjectNotFound' } }]) {
    const { api, calls } = deletionFixture(options);
    await api.deletePhoto('photo');
    assert.equal(calls.includes('metadata'), true);
  }
});

test('other members cannot invoke deletion through the helper', async () => {
  const { api, calls } = deletionFixture({ owner: 'someone-else' });
  await assert.rejects(api.deletePhoto('photo'), /Only the uploader/);
  assert.equal(calls.length, 1);
});

test('zero deleted rows never reports success', async () => {
  const { api } = deletionFixture({ deleted: null });
  await assert.rejects(api.deletePhoto('photo'), /Deletion was denied/);
});


test('silently skipped storage deletion never orphans an existing file', async () => {
  const { api, calls } = deletionFixture({ removed: [], exists: true });
  await assert.rejects(api.deletePhoto('photo'), /file could not be removed/);
  assert.equal(calls.includes('metadata'), false);
});

test('failed missing-file verification leaves metadata available for retry', async () => {
  const { api, calls } = deletionFixture({ removed: [], existsError: { message: 'Network unavailable' } });
  await assert.rejects(api.deletePhoto('photo'), { message: 'Network unavailable' });
  assert.equal(calls.includes('metadata'), false);
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
