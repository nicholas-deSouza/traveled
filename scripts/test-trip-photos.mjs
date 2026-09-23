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

function fixture({ download = async path => ({ data: { path }, error: null }), photosError = null } = {}) {
  const calls = { downloads: [], ranges: [], orders: [], revoked: [], tables: [] };
  const db = {
    from(table) {
      calls.tables.push(table);
      return {
        select() { return this; }, eq() { return this; },
        order(...args) { calls.orders.push(args); return this; },
        range(...args) { calls.ranges.push(args); return Promise.resolve({ data: rows, error: photosError }); },
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
