import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { stageVendor, vendorFiles, vendorSource, verifyVendor } from '../stage-vendor.mjs';

test('reviewed decoder bytes and license match the pinned release provenance', async () => {
  await verifyVendor();
  const original = await readFile(join(vendorSource, 'libheif.cjs'), 'utf8');
  const browser = await readFile(join(vendorSource, 'libheif-browser.mjs'), 'utf8');
  assert.ok(browser.startsWith(original), 'Browser adapter must preserve every upstream factory byte');
  assert.equal(browser.slice(original.length), '\n// Application adapter: expose the unchanged upstream factory to native ES module workers.\nexport default libheif;\n\n');
});
test('compiled output carries the exact reviewed factory, WASM, license and provenance', async () => {
  const output = await mkdtemp(join(tmpdir(), 'traveled-heif-stage-'));
  await stageVendor(output);
  const staged = join(output, 'vendor/libheif-1.23.5');
  await verifyVendor(staged);
  for (const name of vendorFiles) assert.deepEqual(await readFile(join(staged, name)), await readFile(join(vendorSource, name)));
  const require = createRequire(import.meta.url);
  const lib = await require(join(staged, 'libheif.cjs'))({ wasmBinary: await readFile(join(staged, 'libheif.wasm')) });
  assert.equal(lib.heif_get_version(), '1.23.5');
  for (const api of ['HeifDecoder', 'heif_js_context_get_list_of_top_level_image_IDs', 'heif_context_free']) {
    assert.equal(typeof lib[api], 'function', api);
  }
});
