import { StoppedUpload } from './resourcePools';
export function processPhoto(source: Blob, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new StoppedUpload()); return; }
    const worker = new Worker(new URL('./processing.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new StoppedUpload()); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { finish(); reject(new Error('The photo worker failed. Retry this photo.')); };
    worker.onmessage = (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
      finish();
      if (event.data.blob) resolve(event.data.blob);
      else reject(new Error(event.data.error || 'The photo could not be processed.'));
    };
    worker.postMessage({ source });
  });
}
/** Entire optional precheck, including cold model loading/decoding, is capped at five seconds. */
export function precheckPhoto(source: Blob, signal: AbortSignal): Promise<boolean | null> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(null); return; }
    const worker = new Worker(new URL('./processing.worker.ts', import.meta.url), { type: 'module' });
    const finish = (result: boolean | null) => {
      clearTimeout(timer); worker.terminate(); signal.removeEventListener('abort', abort); resolve(result);
    };
    const abort = () => finish(null);
    const timer = setTimeout(() => finish(null), 5000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(null);
    worker.onmessage = (event: MessageEvent<{ advisory?: boolean }>) => finish(event.data.advisory ?? null);
    worker.postMessage({ source, advisory: true });
  });
}
