import type { UploadSubmission } from '../photoUploadContract';

/** Only serializable metadata is persisted. Files and candidate blobs never enter this store. */
export type UploadMetadata = {
  submission: UploadSubmission; admissionRequest: string; candidateRequest: string | null;
  originalAcknowledged: boolean;
  dismissed?: boolean;
  localFailed?: boolean; localError?: string | null;
  localFailureGeneration?: number; localFailureStage?: UploadSubmission['phase'];
};
export interface MetadataStore {
  list(): Promise<UploadMetadata[]>;
  put(value: UploadMetadata): Promise<void>;
  clear(): Promise<void>;
  close?(): void;
}
export function createMetadataStore(userId: string): MetadataStore {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`traveled-photo-uploads-${userId}`, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('submissions', { keyPath: 'submission.id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await database;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('submissions', mode);
      const request = run(transaction.objectStore('submissions'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Upload metadata could not be saved.'));
    });
  }
  return {
    list: () => operation('readonly', (store) => store.getAll()),
    put: async (value) => { await operation('readwrite', (store) => store.put(value)); },
    clear: async () => { await operation('readwrite', (store) => store.clear()); },
    close: () => { void database.then((db) => db.close()).catch(() => undefined); },
  };
}
