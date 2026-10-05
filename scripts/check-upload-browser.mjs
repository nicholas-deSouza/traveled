import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { build, preview } from 'vite';

// Isolated browser worker check. Does not import the app, load .env, or call live services.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function buildUploadBrowserCheck() {
  const outDir = await mkdtemp(resolve(tmpdir(), 'traveled-browser-check-'));
  await build({
    root, configFile: false, envDir: false,
    worker: { format: 'es' },
    build: { target: 'es2022', outDir, emptyOutDir: false, rollupOptions: { input: resolve(root, 'scripts/upload-browser-check.html') } },
  });
  return outDir;
}
export async function startUploadBrowserCheck(port = 5181) {
  const outDir = await buildUploadBrowserCheck();
  const server = await preview({ root, configFile: false, envDir: false,
    build: { outDir }, preview: { host: '127.0.0.1', port, strictPort: true, open: false },
  });
  return { close: () => new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve())) };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const server = await startUploadBrowserCheck();
  console.log('Open http://127.0.0.1:5181/scripts/upload-browser-check.html in each target browser to check production assets.');
  console.log('Generated fixtures stay in memory. Optional HEIC files are processed locally only.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
}
