import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { buildUploadBrowserCheck } from './check-upload-browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
test('Vite resolves the real module worker and vendored browser HEIC assets without credentials', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'traveled-worker-transform-'));
  const server = await createServer({ root, configFile: false, envDir: false, cacheDir,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] }, worker: { format: 'es' },
  });
  try {
    const worker = await server.transformRequest('/src/lib/uploads/processing.worker.ts?worker_file&type=module');
    assert.ok(worker?.code, 'Actual worker must pass Vite import analysis');
    const decoder = await server.transformRequest('/src/lib/uploads/heicDecoder.ts');
    assert.ok(decoder?.code, 'Worker decoder loader must be resolvable');
    const factory = await server.transformRequest('/vendor/libheif-1.23.5/libheif-browser.mjs');
    assert.match(factory?.code ?? '', /export default libheif/, 'Native ES module factory must work in Vite dev');
    const wasm = await server.transformRequest('/vendor/libheif-1.23.5/libheif.wasm?url');
    assert.ok(wasm?.code, 'Pinned browser WASM asset must be resolvable');
    const check = await server.transformRequest('/scripts/upload-browser-check.ts');
    assert.ok(check?.code, 'Browser smoke runner must transform');
  } finally { await server.close(); }
});

test('production browser checker emits workers and resolvable WebP WASM assets', async () => {
  const outDir = await buildUploadBrowserCheck();
  const html = await readFile(join(outDir, 'scripts/upload-browser-check.html'), 'utf8');
  assert.doesNotMatch(html, /\/scripts\/upload-browser-check\.ts|@vite\/client/);
  assert.match(html, /\/assets\/upload-browser-check-[\w-]+\.js/);
  const assets = await readdir(join(outDir, 'assets'));
  assert.ok(assets.some(name => /^processing\.worker-.*\.js$/.test(name)));
  const fallback = assets.find(name => /^upload-browser-fallback\.worker-.*\.js$/.test(name));
  assert.ok(fallback, 'Forced Safari fallback worker must be production-built');
  assert.match(await readFile(join(outDir, 'assets', fallback), 'utf8'), /image\/png/);
  const encoder = assets.find(name => /^webpEncoder-.*\.js$/.test(name));
  assert.ok(encoder, 'Lazy-loaded encoder must be emitted');
  const encoderCode = await readFile(join(outDir, 'assets', encoder), 'utf8');
  for (const prefix of ['webp_enc-', 'webp_enc_simd-']) {
    const wasm = assets.find(name => name.startsWith(prefix) && name.endsWith('.wasm'));
    assert.ok(wasm, `${prefix} WASM must be emitted`);
    assert.ok(encoderCode.includes(`/assets/${wasm}`), 'Encoder URL must reference the emitted WASM');
    const bytes = await readFile(join(outDir, 'assets', wasm));
    assert.ok(WebAssembly.validate(bytes), 'Emitted codec must be valid WASM');
  }
});
