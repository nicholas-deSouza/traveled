import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const vendorFiles = ['libheif.cjs', 'libheif-browser.mjs', 'libheif.wasm', 'LICENSE', 'provenance.json'];
export const vendorSource = fileURLToPath(new URL('../../vendor/libheif-1.23.5/', import.meta.url));
export async function verifyVendor(source = vendorSource) {
  const provenance = JSON.parse(await readFile(join(source, 'provenance.json'), 'utf8'));
  assert.equal(provenance.version, '1.23.5');
  assert.equal(provenance.commit, '5c8968a44e9c68ae677e24790d77d001ed7fe7cc');
  assert.equal(provenance.archiveSha256, '0fa8629a75344389f0da842f659cc952ecaa39cde400eed42b80e4a82a3af778');
  for (const name of vendorFiles.filter(name => name !== 'provenance.json')) {
    assert.equal(createHash('sha256').update(await readFile(join(source, name))).digest('hex'),
      provenance.files[name].sha256, `Vendored libheif integrity: ${name}`);
  }
}
export async function stageVendor(output, source = vendorSource) {
  await verifyVendor(source);
  const destination = join(resolve(output), 'vendor/libheif-1.23.5');
  await mkdir(destination, { recursive: true });
  for (const name of vendorFiles) await cp(join(source, name), join(destination, name));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.ok(process.argv[2], 'Compiled output directory required');
  await stageVendor(process.argv[2]);
}
