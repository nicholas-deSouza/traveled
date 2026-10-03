import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { makeUploadFixtures } from './make-upload-fixtures.mjs';
import { detectFormat, prepareImage } from '../infrastructure/photo-classifier/src/images.ts';

test('generated fixtures have a real rotation tag, artificial zero GPS, and rejected malformed/unsupported bytes', async () => {
  const files = await makeUploadFixtures();
  const require = createRequire(new URL('../infrastructure/photo-classifier/package.json', import.meta.url));
  const sharp = require('sharp');
  const { gps } = require('exifr');
  const rotated = await sharp(await readFile(files.rotated)).metadata();
  assert.equal(rotated.orientation, 6);
  assert.equal(rotated.width, 320); assert.equal(rotated.height, 160);
  assert.deepEqual(await gps(await readFile(files.gps)), { latitude: 0, longitude: 0 });
  for (const key of ['animatedGif', 'animatedWebp']) {
    assert.equal((await sharp(await readFile(files[key]), { animated: true }).metadata()).pages, 2, key);
  }
  for (const key of ['damagedJpeg', 'damagedPng', 'damagedWebp', 'damagedHeic', 'renamedText', 'gif', 'avif', 'animatedGif', 'animatedWebp']) {
    await assert.rejects(prepareImage(await readFile(files[key]), 'original'), undefined, key);
  }
  assert.equal(detectFormat(await readFile(files.gps)), 'jpeg');
  assert.equal(detectFormat(await readFile(files.rotated)), 'jpeg');
});
