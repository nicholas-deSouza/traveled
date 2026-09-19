import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/components/maps/TravelGlobe.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace('import.meta.env.VITE_MAP_STYLE_URL', 'configuredStyle'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function fixture(configuredStyle) {
  function target() {
    const listeners = new Map();
    return {
      listeners,
      addEventListener: (name, handler) => listeners.set(name, handler),
      removeEventListener: name => listeners.delete(name),
      emit: name => listeners.get(name)?.(),
    };
  }
  const element = target();
  const media = { ...target(), matches: false };
  const document = { ...target(), hidden: false };
  const window = { ...target(), matchMedia: () => media };
  let now = 1000, callback, cleanup, longitude = 0, removed = false, moving = false, style;
  const map = {
    addControl() {}, on() {}, isStyleLoaded: () => true,
    isMoving: () => moving, getCenter: () => ({ lng: longitude, lat: 30 }),
    jumpTo: ({ center }) => { longitude = center[0]; }, remove: () => { removed = true; },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, window, document, configuredStyle, performance: { now: () => now },
    requestAnimationFrame: fn => { callback = fn; return 1; },
    cancelAnimationFrame: () => { callback = undefined; },
    require: name => {
      if (name === 'react') return { useState: value => [typeof value === 'function' ? value() : value, () => {}], useRef: value => ({ current: value === null ? element : value }), useEffect: fn => { cleanup = fn(); } };
      if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === 'maplibre-gl') return { default: { Map: function (options) { style = options.style; return map; }, NavigationControl: function () {} } };
      if (name.includes('button')) return { Button: 'button' };
      if (name.includes('domain')) return { demoTrips: [] };
      throw new Error(name);
    },
  });
  const tree = exports.TravelGlobe();
  const toggle = tree.props.children[1].props.children[0].props.onClick;
  function tick(ms = 16) { now += ms; callback?.(now); }
  tick();
  return { element, window, document, media, style, toggle, tick, cleanup: () => cleanup(), longitude: () => longitude, removed: () => removed, running: () => Boolean(callback), setMoving: value => { moving = value; } };
}

test('missing, empty, and whitespace style URLs use the default map', () => {
  for (const value of [undefined, '', '  ']) {
    assert.equal(fixture(value).style, 'https://tiles.openfreemap.org/styles/liberty');
  }
  assert.equal(fixture(' https://example.com/style.json ').style, 'https://example.com/style.json');
});

test('rotation speed is independent of frame rate', () => {
  const fast = fixture(), slow = fixture(), lowFrameRate = fixture();
  for (let i = 0; i < 100; i++) fast.tick(10);
  for (let i = 0; i < 20; i++) slow.tick(50);
  for (let i = 0; i < 5; i++) lowFrameRate.tick(200);
  assert(Math.abs(fast.longitude() - 2) < 1e-9);
  assert(Math.abs(slow.longitude() - fast.longitude()) < 1e-9);
  assert(Math.abs(lowFrameRate.longitude() - fast.longitude()) < 1e-9);
});

test('interaction pauses rotation until five seconds after release', () => {
  const f = fixture();
  f.element.emit('pointerdown');
  for (let i = 0; i < 100; i++) f.tick(100);
  assert.equal(f.longitude(), 0);
  f.window.emit('pointerup');
  f.tick(4999); assert.equal(f.longitude(), 0);
  f.tick(16); assert(f.longitude() > 0);
});

test('explicit pause survives interaction and only resumes on request', () => {
  const f = fixture();
  f.toggle(); f.element.emit('wheel'); f.tick(6000);
  assert.equal(f.longitude(), 0);
  f.toggle(); f.tick(); assert(f.longitude() > 0);
});

test('hidden pages, reduced motion, and ongoing map movement prevent rotation', () => {
  const f = fixture();
  f.document.hidden = true; f.tick(); assert.equal(f.longitude(), 0);
  f.document.hidden = false; f.media.matches = true; f.tick(); assert.equal(f.longitude(), 0);
  f.media.matches = false; f.setMoving(true); f.tick(); assert.equal(f.longitude(), 0);
  f.setMoving(false); f.tick(); assert(f.longitude() > 0);
});

test('leaving Explore removes animation, listeners, and map', () => {
  const f = fixture(); f.cleanup();
  assert.equal(f.running(), false); assert.equal(f.removed(), true);
  for (const target of [f.element, f.window, f.document, f.media]) assert.equal(target.listeners.size, 0);
});
