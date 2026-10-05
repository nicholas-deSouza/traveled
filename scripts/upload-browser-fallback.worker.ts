// Local release-check worker: simulate Safari's PNG fallback with the real codec.
const nativeConvert = OffscreenCanvas.prototype.convertToBlob;
OffscreenCanvas.prototype.convertToBlob = function () {
  return nativeConvert.call(this, { type: 'image/png' });
};
await import('../src/lib/uploads/processing.worker');
self.postMessage({ ready: true });
export {};
