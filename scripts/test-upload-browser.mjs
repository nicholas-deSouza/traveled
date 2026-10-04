import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

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
