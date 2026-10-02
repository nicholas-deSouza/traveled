import { vi } from 'vitest';
import type { UploadSubmission } from '../photoUploadContract';
import type { MetadataStore, UploadMetadata } from './metadataStore';
/** Deterministic browser lock stand-in preserving exclusion and pending-leader semantics. */
export function fakeLocks(): LockManager {
  const held = new Set<string>();
  const pending = new Map<string, (() => void)[]>();
  return {
    async request(name: string, optionsOrCallback: LockOptions | LockGrantedCallback, possibleCallback?: LockGrantedCallback) {
      const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : possibleCallback!;
      if (held.has(name)) {
        if (options.ifAvailable) return callback(null);
        await new Promise<void>((resolve, reject) => {
          pending.set(name, [...(pending.get(name) ?? []), resolve]);
          options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      }
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      held.add(name);
      try { return await callback({ name, mode: 'exclusive' } as Lock); }
      finally { held.delete(name); pending.get(name)?.shift()?.(); }
    },
  } as LockManager;
}
export function memoryStore(): MetadataStore & { values: Map<string, UploadMetadata> } {
  const values = new Map<string, UploadMetadata>();
  return { values, list: async () => [...values.values()], put: async (value) => { values.set(value.submission.id, structuredClone(value)); }, clear: async () => { values.clear(); } };
}
export function fakeChannel(): BroadcastChannel {
  return { postMessage: vi.fn(), close: vi.fn(), onmessage: null } as unknown as BroadcastChannel;
}
export function submission(overrides: Partial<UploadSubmission> = {}): UploadSubmission {
  return { id: 'submission', trip_id: 'trip', user_id: 'user', filename: 'photo.jpg', phase: 'original_upload', outcome: null,
    generation: 0, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString(),
    gps_acknowledged: false, latitude: null, longitude: null, source_sha256: 'sha', source_bytes: 3,
    retry_at: null, attempts: 0, error: null, pause_reason: null, cleanup_pending: false, ...overrides };
}
