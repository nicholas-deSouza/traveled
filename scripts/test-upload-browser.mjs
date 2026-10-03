import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
test('Vite resolves the real module worker and browser HEIC bundle without credentials', async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'traveled-worker-transform-'));
  const server = await createServer({ root, configFile: false, envDir: false, cacheDir,
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] }, worker: { format: 'es' },
  });
  try {
    const worker = await server.transformRequest('/src/lib/uploads/processing.worker.ts?worker_file&type=module');
    assert.ok(worker?.code, 'Actual worker must pass Vite import analysis');
    const bundle = await server.transformRequest('/node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs');
    assert.ok(bundle?.code, 'Pinned browser HEIC bundle must be resolvable');
    const check = await server.transformRequest('/scripts/upload-browser-check.ts');
    assert.ok(check?.code, 'Browser smoke runner must transform');
  } finally { await server.close(); }
});
