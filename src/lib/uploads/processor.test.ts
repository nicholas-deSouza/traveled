import { afterEach, describe, expect, it, vi } from 'vitest';
import { precheckPhoto, processPhoto, previewPhoto } from './processor';
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeWorker.instances.length = 0; });
describe('worker lifetime', () => {
  it('terminates cold advisory work at five seconds and continues with no verdict', async () => {
    vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker);
    const result = precheckPhoto(new Blob(['source']), new AbortController().signal);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBeNull();
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('terminates processing promptly on sign-out/cancellation', async () => {
    vi.stubGlobal('Worker', FakeWorker); const controller = new AbortController();
    const result = processPhoto(new Blob(['source']), controller.signal);
    const rejected = expect(result).rejects.toThrow('stopped'); controller.abort(); await rejected;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
  it('propagates visible processing errors rather than treating them as an approved candidate', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const result = processPhoto(new Blob(['source']), new AbortController().signal);
    FakeWorker.instances[0].onmessage?.({ data: { error: 'The optimized photo exceeds 8 MiB.' } } as MessageEvent);
    await expect(result).rejects.toThrow('8 MiB');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});

it('returns a decoded preview and terminates its worker when selection is removed', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const controller = new AbortController();
  const source = new Blob(['heic']);
  const pending = previewPhoto(source, controller.signal);
  expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledWith({ source, preview: true });
  const rejected = expect(pending).rejects.toThrow('stopped');
  controller.abort();
  await rejected;
  expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
});
