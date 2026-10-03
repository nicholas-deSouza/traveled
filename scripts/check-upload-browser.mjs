import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

// Isolated browser worker check. Does not import the app, load .env, or call live services.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function startUploadBrowserCheck(port = 5181) {
  const cacheDir = await mkdtemp(resolve(tmpdir(), 'traveled-browser-check-'));
  const server = await createServer({
    root, configFile: false, envDir: false, cacheDir,
    worker: { format: 'es' },
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false, ws: false },
    plugins: [{
      name: 'upload-browser-check',
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/upload-browser-check.html') return next();
          try {
            const html = await readFile(resolve(root, 'scripts/upload-browser-check.html'), 'utf8');
            response.setHeader('Content-Type', 'text/html');
            response.end(await vite.transformIndexHtml('/upload-browser-check.html', html));
          } catch (error) { next(error); }
        });
      },
    }],
  });
  await server.listen();
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const server = await startUploadBrowserCheck();
  console.log('Open http://127.0.0.1:5181/upload-browser-check.html in each target browser.');
  console.log('Generated fixtures stay in memory. Optional HEIC files are processed locally only.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
}
