import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../src/components/photos/useTripPhotos.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Drive hook renders/effect cleanup deterministically while controlling pending I/O.
// These checks cover resource ownership and races; browser focus/layout needs UI QA.
function fixture() {
  const slots = [], effects = [], requests = [], revoked = [];
  let cursor = 0, pendingEffects = [], value;
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!effects[i] || deps.some((dep, j) => !Object.is(dep, effects[i].deps[j]))) {
        pendingEffects.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const exports = {};
  vm.runInNewContext(compiled, { exports, require(name) {
    if (name === 'react') return react;
    return {
      errorMessage: error => error.message,
      releasePhotos: photos => photos.forEach(photo => { if (photo.url) revoked.push(photo.url); }),
      loadTripPhotos: (trip, page, previous) => new Promise((resolve, reject) => requests.push({ trip, page, previous, resolve, reject })),
    };
  } });
  function render(trip = 'trip', page = 0) {
    cursor = 0; pendingEffects = [];
    value = exports.useTripPhotos(trip, page);
    pendingEffects.forEach(run => run());
    return value;
  }
  function unmount() { effects.forEach(effect => effect?.cleanup?.()); }
  return { render, unmount, requests, revoked };
}
const photo = id => ({ id, storage_path: `${id}.jpg`, uploaded_by: 'member', url: `blob:${id}` });
const pageData = photos => ({ photos, hasMore: false });
async function settle() { await Promise.resolve(); await Promise.resolve(); }

test('deletion keeps other images visible and owned during metadata refresh', async () => {
  const f = fixture(); f.render();
  f.requests[0].resolve(pageData([photo('a'), photo('b')])); await settle();
  let view = f.render(); view.removeLocal('a'); view.reload();
  view = f.render();
  assert.equal(view.data.photos.length, 1);
  assert.equal(view.data.photos[0].url, 'blob:b');
  assert.equal(view.loading, false); assert.equal(view.refreshing, true);
  assert.deepEqual(f.revoked, ['blob:a']);
  assert.equal(f.requests[1].previous[0].url, 'blob:b');
  f.requests[1].resolve(pageData([photo('b'), photo('c')])); await settle();
  view = f.render(); assert.equal(view.refreshing, false);
  assert.deepEqual(f.revoked, ['blob:a']);
  f.unmount(); assert.deepEqual(f.revoked, ['blob:a', 'blob:b', 'blob:c']);
});

test('stale refresh disposes only newly downloaded URLs', async () => {
  const f = fixture(); f.render();
  f.requests[0].resolve(pageData([photo('a')])); await settle();
  let view = f.render(); view.reload(); view = f.render();
  view.reload(); f.render();
  f.requests[1].resolve(pageData([photo('a'), photo('stale')])); await settle();
  assert.deepEqual(f.revoked, ['blob:stale']);
  f.requests[2].resolve(pageData([photo('a'), photo('current')])); await settle();
  assert.equal(f.render().data.photos[1].id, 'current');
  f.unmount(); assert.deepEqual(f.revoked, ['blob:stale', 'blob:a', 'blob:current']);
});

test('unmount releases cached images and late downloads without double disposal', async () => {
  const f = fixture(); f.render();
  f.requests[0].resolve(pageData([photo('a')])); await settle();
  f.render().reload(); f.render(); f.unmount();
  f.requests[1].resolve(pageData([photo('a'), photo('late')])); await settle();
  assert.deepEqual(f.revoked, ['blob:a', 'blob:late']);
});

test('refresh failure retains displayed images and permits retry', async () => {
  const f = fixture(); f.render();
  f.requests[0].resolve(pageData([photo('a')])); await settle();
  f.render().reload(); f.render();
  f.requests[1].reject(new Error('Offline')); await settle();
  const view = f.render();
  assert.equal(view.data.photos[0].url, 'blob:a');
  assert.equal(view.error, 'Offline'); assert.equal(view.refreshing, false);
  assert.deepEqual(f.revoked, []);
  view.reload(); f.render(); assert.equal(f.requests.length, 3);
  f.unmount();
});

test('moving to another trip clears old images and never shares its cache', async () => {
  const f = fixture(); f.render();
  f.requests[0].resolve(pageData([photo('a')])); await settle(); f.render();
  const view = f.render('other');
  assert.equal(view.data, undefined); assert.equal(view.loading, true);
  assert.equal(f.requests[1].previous.length, 0);
  assert.deepEqual(f.revoked, ['blob:a']);
  f.unmount(); f.requests[1].resolve(pageData([photo('late')])); await settle();
  assert.deepEqual(f.revoked, ['blob:a', 'blob:late']);
});
