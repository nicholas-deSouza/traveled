import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Generated scenes contain no personal information. GPS is the artificial test point 0,0.
// Reuses the classifier's pinned Sharp; install its locked dependencies first.
function gpsExif() {
  const tiff = Buffer.alloc(128);
  tiff.write('II'); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10); tiff.writeUInt16LE(4, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt32LE(26, 18);
  tiff.writeUInt16LE(4, 26);
  const entry = (offset, tag, type, count, value) => {
    tiff.writeUInt16LE(tag, offset); tiff.writeUInt16LE(type, offset + 2);
    tiff.writeUInt32LE(count, offset + 4); tiff.writeUInt32LE(value, offset + 8);
  };
  entry(28, 1, 2, 2, 78); entry(40, 2, 5, 3, 80);
  entry(52, 3, 2, 2, 69); entry(64, 4, 5, 3, 104);
  for (const offset of [80, 88, 96, 104, 112, 120]) tiff.writeUInt32LE(1, offset + 4);
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), tiff]);
  const segment = Buffer.alloc(4); segment[0] = 255; segment[1] = 225; segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([segment, payload]);
}
export async function makeUploadFixtures() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const require = createRequire(join(root, 'infrastructure/photo-classifier/package.json'));
  const sharp = require('sharp');
  const output = await mkdtemp(join(tmpdir(), 'traveled-upload-fixtures-'));
  const images = {};
  for (const format of ['jpeg', 'png', 'webp']) {
    const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#85a76b' } })[format]().toBuffer();
    const path = join(output, `synthetic.${format === 'jpeg' ? 'jpg' : format}`);
    await writeFile(path, bytes); images[format] = path;
  }
  const invalid = join(output, 'unsupported.txt');
  await writeFile(invalid, 'This is a disposable upload-validation fixture, not an image.');
  images.unsupported = invalid;
  const empty = join(output, 'empty.jpg'); await writeFile(empty, ''); images.empty = empty;
  // Asymmetric quadrants make an incorrect EXIF rotation visible, unlike a solid scene.
  const scene = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="160" height="80" fill="#c43a32"/><rect x="160" width="160" height="80" fill="#1c693c"/><rect y="80" width="160" height="80" fill="#326ac4"/><rect x="160" y="80" width="160" height="80" fill="#dfa52c"/></svg>');
  images.rotated = join(output, 'orientation-6.jpg');
  await writeFile(images.rotated, await sharp(scene).withMetadata({ orientation: 6 }).jpeg().toBuffer());
  const jpeg = await sharp(scene).jpeg().toBuffer();
  images.gps = join(output, 'synthetic-gps-zero.jpg');
  await writeFile(images.gps, Buffer.concat([jpeg.subarray(0, 2), gpsExif(), jpeg.subarray(2)]));
  const malformed = {
    damagedJpeg: ['damaged.jpg', Buffer.from([255, 216, 255, 224, 0, 16, 1, 2, 3])],
    damagedPng: ['damaged.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 255, 73, 72, 68, 82, 0, 0, 0, 0])],
    damagedWebp: ['damaged.webp', Buffer.from('RIFF\xff\xff\xff\x7fWEBPVP8 \xff\xff\xff\x7f')],
    damagedHeic: ['damaged.heic', Buffer.from([0, 0, 0, 16, ...Buffer.from('ftypheic'), 0, 0, 0, 0])],
    renamedText: ['renamed-text.jpg', Buffer.from('Not a photo, despite the JPEG filename.')],
    gif: ['unsupported.gif', await sharp(scene).gif().toBuffer()],
    avif: ['unsupported.avif', await sharp(scene).avif().toBuffer()],
  };
  for (const [key, [name, bytes]] of Object.entries(malformed)) {
    images[key] = join(output, name); await writeFile(images[key], bytes);
  }
  const frames = Buffer.alloc(32 * 32 * 2 * 3);
  for (let pixel = 0; pixel < 32 * 32 * 2; pixel++) frames[pixel * 3 + (pixel < 32 * 32 ? 0 : 1)] = 180;
  for (const format of ['gif', 'webp']) {
    const key = `animated${format === 'gif' ? 'Gif' : 'Webp'}`;
    images[key] = join(output, `animated.${format}`);
    await writeFile(images[key], await sharp(frames, { raw: { width: 32, height: 64, channels: 3, pageHeight: 32 } })[format]({ delay: [100, 100], loop: 0 }).toBuffer());
  }
  return images;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(JSON.stringify(await makeUploadFixtures(), null, 2));
}
