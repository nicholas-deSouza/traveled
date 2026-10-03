import { processPhoto } from '../src/lib/uploads/processor';

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
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  assert(Boolean(context), '2D canvas unavailable');
  context!.fillStyle = '#85a76b'; context!.fillRect(0, 0, width, height);
  const blob = await canvas.convertToBlob({ type });
  assert(blob.type === type, `Browser cannot encode ${type} test input`);
  return blob;
}
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
for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
  await check(`${type} decoded and optimized by real worker`, async () => optimize(await source(type), 96, 48));
}
await check('Aspect ratio preserved at 2560-pixel limit', async () => optimize(await source('image/png', 3200, 1600), 2560, 1280));
await check('Small images are not upscaled', async () => optimize(await source('image/png', 16, 8), 16, 8));
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
  if (file) await check('Selected single-photo HEIC decoded locally', () => optimize(file));
  fileInput.value = '';
});
