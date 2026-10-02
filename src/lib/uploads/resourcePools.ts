export type ResourceKind = 'processing' | 'upload' | 'buffer';
export type ResourceLimits = Record<ResourceKind, number>;
export function deviceLimits(phone: boolean): ResourceLimits {
  return phone ? { processing: 1, upload: 2, buffer: 2 } : { processing: 2, upload: 3, buffer: 3 };
}
export class StoppedUpload extends Error { constructor() { super('Upload work stopped.'); } }
export function pause(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new StoppedUpload()); return; }
    const abort = () => { clearTimeout(timer); reject(new StoppedUpload()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** Web Locks are shared across tabs and held for the actual work, including a retained buffer. */
export class ResourcePools {
  constructor(private locks: LockManager, private account: string, readonly limits: ResourceLimits) {}
  async acquire(kind: ResourceKind, signal: AbortSignal): Promise<() => void> {
    while (!signal.aborted) {
      for (let index = 0; index < this.limits[kind]; index++) {
        let release: (() => void) | undefined;
        let acquired!: () => void;
        const ready = new Promise<void>((resolve) => { acquired = resolve; });
        void this.locks.request(`${this.account}:${kind}:${index}`, { ifAvailable: true }, async (lock) => {
          if (!lock) { acquired(); return; }
          await new Promise<void>((resolve) => { release = resolve; acquired(); });
        });
        await ready;
        if (release) {
          const heldRelease = release;
          if (signal.aborted) { heldRelease(); throw new StoppedUpload(); }
          // An in-flight immutable transfer may outlive cancellation. Its actual owner
          // releases in finally, so another tab cannot overtake live memory/network work.
          return heldRelease;
        }
      }
      await pause(100, signal);
    }
    throw new StoppedUpload();
  }
  async run<T>(kind: ResourceKind, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    const release = await this.acquire(kind, signal);
    try { if (signal.aborted) throw new StoppedUpload(); return await work(); }
    finally { release(); }
  }
}
