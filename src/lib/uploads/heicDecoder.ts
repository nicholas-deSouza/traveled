/** The reviewed upstream factory accepts bytes, so worker decoding needs no Node filesystem APIs. */
export async function initializeHeicDecoder() {
  const [{ default: initialize }, { default: wasmUrl }] = await Promise.all([
    import('../../../vendor/libheif-1.23.5/libheif-browser.mjs'),
    import('../../../vendor/libheif-1.23.5/libheif.wasm?url'),
  ]);
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error('The HEIC decoder could not be loaded.');
  const library = await initialize({ wasmBinary: new Uint8Array(await response.arrayBuffer()) });
  if (library.heif_get_version() !== '1.23.5') throw new Error('The HEIC decoder version is invalid.');
  return library;
}
