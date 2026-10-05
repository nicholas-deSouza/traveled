import { createRunningUploadManager, isUploadCompatible, type ManagerDependencies, type UploadManager as RunningManager, type UploadSnapshot } from './uploadManager';
import { createMetadataStore, type MetadataStore } from './metadataStore';
export type { UploadItem, UploadSnapshot, ManagerDependencies } from './uploadManager';
export type UploadManager = Omit<RunningManager, 'stop'> & { start(): void; stop(): void };

/** Construction is side-effect free; start/stop match React's effect lifetime, including StrictMode. */
export function createUploadManager(userId: string, dependencies: Partial<ManagerDependencies> = {}): UploadManager {
  let running: RunningManager | undefined;
  let unsubscribe: (() => void) | undefined;
  let store: MetadataStore | undefined = dependencies.store;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const compatible = dependencies.compatible ?? isUploadCompatible();
  let snapshot: UploadSnapshot = { items: [], compatible, error: compatible ? null : 'Photo uploading requires Web Locks, IndexedDB, workers, and canvas support. Use a current supported browser.' };
  const emit = () => { for (const listener of listeners) listener(); };
  const active = () => { if (!running) throw new Error('The upload queue has stopped.'); return running; };
  return {
    start() {
      if (running) return;
      if (closeTimer !== undefined) { clearTimeout(closeTimer); closeTimer = undefined; }
      if (!store && compatible) store = createMetadataStore(userId);
      running = createRunningUploadManager(userId, { ...dependencies, ...(store ? { store } : {}) });
      snapshot = running.getSnapshot();
      unsubscribe = running.subscribe(() => { snapshot = running!.getSnapshot(); emit(); });
      emit();
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    enqueue: (tripId, files) => active().enqueue(tripId, files),
    retry: (id) => active().retry(id),
    cancel: (id) => active().cancel(id),
    clearFinished: () => active().clearFinished(),
    reselect: (id, file) => active().reselect(id, file),
    stop() {
      unsubscribe?.(); unsubscribe = undefined;
      if (!running) return;
      running.stop(); running = undefined;
      // Release bytes immediately and close the account's store after StrictMode's
      // synchronous restart window. Dismissal and recovery metadata survive logout.
      const stoppedStore = store;
      closeTimer = setTimeout(() => {
        closeTimer = undefined;
        store = dependencies.store;
        stoppedStore?.close?.();
      }, 0);
      snapshot = { ...snapshot, items: [] }; emit();
    },
  };
}
