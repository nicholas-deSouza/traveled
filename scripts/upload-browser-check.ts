import { processPhoto, previewPhoto } from '../src/lib/uploads/processor';
import { createMetadataStore, type UploadMetadata } from '../src/lib/uploads/metadataStore';

type Result = { case: string; result: 'PASS' | 'FAIL'; detail: string };
const results: Result[] = [];
const output = document.getElementById('results')!;
const status = document.getElementById('status')!;
function assert(ok: boolean, message: string): asserts ok { if (!ok) throw new Error(message); }
async function check(name: string, run: () => Promise<void>) {
  try { await run(); results.push({ case: name, result: 'PASS', detail: 'Expected behavior verified' }); }
  catch (error) { results.push({ case: name, result: 'FAIL', detail: error instanceof Error ? error.message : 'Failed' }); }
  output.textContent = JSON.stringify(results, null, 2);
  status.textContent = results.some(result => result.result === 'FAIL') ? 'FAIL — inspect results' : `${results.length} checks passed`;
}
async function source(type: string, width = 96, height = 48) {
  if (type === 'image/webp') return processPhoto(await source('image/png', width, height), new AbortController().signal);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  assert(Boolean(context), '2D canvas unavailable');
  context!.fillStyle = '#85a76b'; context!.fillRect(0, 0, width, height);
  const blob = await canvas.convertToBlob({ type });
  assert(blob.type === type, `Browser cannot encode ${type} test input`);
  return blob;
}
await check('Clear survives stale writes from another browser database connection', async () => {
  const account = `browser-check-${crypto.randomUUID()}`;
  const first = createMetadataStore(account), second = createMetadataStore(account);
  const metadata: UploadMetadata = {
    submission: { id: 'finished', trip_id: 'test-trip', user_id: account, filename: 'test.jpg', phase: 'complete', outcome: 'invalid',
      generation: 0, created_at: new Date().toISOString(), expires_at: new Date().toISOString(), gps_acknowledged: false,
      latitude: null, longitude: null, source_sha256: null, source_bytes: 0, retry_at: null, attempts: 0, error: null,
      pause_reason: null, cleanup_pending: true },
    admissionRequest: 'test-admission', candidateRequest: null, originalAcknowledged: true,
  };
  try {
    await first.put(metadata);
    const stale = (await second.list())[0];
    await first.put({ ...metadata, dismissed: true });
    await second.put({ ...stale, submission: { ...stale.submission, cleanup_pending: false } });
    const saved = (await first.list())[0];
    assert(saved.dismissed === true, 'Another connection restored a cleared result');
    assert(saved.submission.cleanup_pending === false, 'Preserving dismissal discarded new server state');
  } finally { await first.clear(); first.close?.(); second.close?.(); }
});
await check('Bundled WebP encoder loads in a real worker when native encoding returns PNG', async () => {
  const input = await source('image/png');
  const worker = new Worker(new URL('./upload-browser-fallback.worker.ts', import.meta.url), { type: 'module' });
  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fallback worker timed out')), 20000);
      worker.onerror = () => { clearTimeout(timer); reject(new Error('Fallback worker failed')); };
      worker.onmessage = (event: MessageEvent<{ ready?: boolean; blob?: Blob; error?: string }>) => {
        if (event.data.ready) { worker.postMessage({ source: input }); return; }
        clearTimeout(timer);
        if (event.data.blob) resolve(event.data.blob);
        else reject(new Error(event.data.error || 'Fallback returned no photo'));
      };
    });
    assert(blob.type === 'image/webp', 'Fallback output is not WebP');
    const bitmap = await createImageBitmap(blob);
    try { assert(bitmap.width === 96 && bitmap.height === 48, 'Fallback WebP could not be decoded at the expected size'); }
    finally { bitmap.close(); }
  } finally { worker.terminate(); }
});
async function optimize(source: Blob, width?: number, height?: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const output = await processPhoto(source, controller.signal);
    assert(output.type === 'image/webp', 'Output is not WebP');
    assert(output.size <= 8 * 1024 * 1024, 'Candidate exceeds 8 MiB');
    const bitmap = await createImageBitmap(output);
    try {
      assert(Math.max(bitmap.width, bitmap.height) <= 2560, 'Candidate dimensions exceed 2560');
      if (width !== undefined) assert(bitmap.width === width && bitmap.height === height, 'Unexpected size or orientation');
    } finally { bitmap.close(); }
  } finally { clearTimeout(timer); }
}
async function preview(source: Blob, width?: number, height?: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const output = await previewPhoto(source, controller.signal);
    assert(output.type === 'image/png', 'Preview is not browser-readable PNG');
    const bitmap = await createImageBitmap(output);
    try {
      assert(Math.max(bitmap.width, bitmap.height) <= 320, 'Preview exceeds 320 pixels');
      if (width !== undefined) assert(bitmap.width === width && bitmap.height === height, 'Unexpected preview dimensions');
    } finally { bitmap.close(); }
  } finally { clearTimeout(timer); }
}
for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
  await check(`${type} decoded and optimized by real worker`, async () => optimize(await source(type), 96, 48));
}
await check('Aspect ratio preserved at 2560-pixel limit', async () => optimize(await source('image/png', 3200, 1600), 2560, 1280));
await check('Small images are not upscaled', async () => optimize(await source('image/png', 16, 8), 16, 8));
await check('Selection preview preserves aspect ratio at 320 pixels', async () => preview(await source('image/png', 3200, 1600), 320, 160));
await check('Selection preview never upscales small images', async () => preview(await source('image/png', 16, 8), 16, 8));
await check('JPEG EXIF orientation applied', async () => {
  const original = new Uint8Array(await (await source('image/jpeg')).arrayBuffer());
  // APP1: big-endian TIFF with orientation 6 (90 degrees clockwise).
  const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,77,77,0,42,0,0,0,8,0,1,1,18,0,3,0,0,0,1,0,6,0,0,0,0,0,0]);
  await optimize(new Blob([original.slice(0, 2), exif, original.slice(2)], { type: 'image/jpeg' }), 48, 96);
});
await check('Damaged HEIC initializes packaged WASM and fails safely', async () => {
  const damaged = new Blob([new Uint8Array([0,0,0,16,102,116,121,112,104,101,105,99,0,0,0,0])]);
  try { await optimize(damaged); throw new Error('Damaged HEIC was accepted'); }
  catch (error) { assert(error instanceof Error && error.message.includes('exactly one photo'), 'HEIC module failed to load or returned an unexpected error'); }
});
await check('Oversized original rejected before decoding', async () => {
  try { await optimize(new Blob([new Uint8Array(20 * 1024 * 1024 + 1)])); throw new Error('Oversized original accepted'); }
  catch (error) { assert(error instanceof Error && error.message.includes('20 MiB'), 'Unexpected size-limit error'); }
});
const fileInput = document.getElementById('heic') as HTMLInputElement;
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (file) {
    await check('Selected single-photo HEIC decoded locally', () => optimize(file));
    await check('Selected HEIC preview is a bounded browser-readable PNG', () => preview(file));
  }
  fileInput.value = '';
});
