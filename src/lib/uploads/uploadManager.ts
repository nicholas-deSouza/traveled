import { UPLOAD_LIMITS, retryDelay, type UploadRequest, type UploadSubmission, type UploadTarget } from '../photoUploadContract';
import { extractLocation } from '../photoMetadata';
import { createMetadataStore, type MetadataStore, type UploadMetadata } from './metadataStore';
import { photoUploadApi, UploadApiError, type PhotoUploadApi } from './photoUploadApi';
import { assertSourceSize, fingerprint, validateSourceFile } from './imageValidation';
import { processPhoto, precheckPhoto, previewPhoto } from './processor';
import { deviceLimits, ResourcePools, pause, StoppedUpload } from './resourcePools';

export type UploadItem = UploadSubmission & {
  local_status: 'waiting' | 'working' | 'needs_file' | 'failed' | null;
  local_error: string | null;
  local_warning?: string | null;
};
export type UploadSnapshot = { items: UploadItem[]; error: string | null; compatible: boolean };
type BrowserStage = Extract<UploadRequest, { action: 'browser_failure' }>['stage'];
type FailureContext = { stage: BrowserStage; generation: number };
export type UploadManager = {
  subscribe(listener: () => void): () => void;
  getSnapshot(): UploadSnapshot;
  enqueue(tripId: string, files: File[]): Promise<void>;
  preview(source: Blob, signal: AbortSignal): Promise<Blob>;
  retry(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
  clearFinished(): Promise<void>;
  reselect(id: string, file: File): Promise<void>;
  stop(): void;
};
export type ManagerDependencies = {
  api: PhotoUploadApi; store: MetadataStore; locks: LockManager; channel: BroadcastChannel;
  process(source: Blob, signal: AbortSignal): Promise<Blob>;
  precheck?(source: Blob, signal: AbortSignal): Promise<boolean | null>;
  preview?(source: Blob, signal: AbortSignal): Promise<Blob>;
  fingerprint(blob: Blob): Promise<string>;
  validateSource(file: Blob): Promise<void>;
  gps(file: File): Promise<{ latitude: number | null; longitude: number | null }>;
  online(): boolean; phone: boolean; compatible: boolean;
};
export function isUploadCompatible(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.locks) && typeof BroadcastChannel !== 'undefined'
    && typeof indexedDB !== 'undefined' && typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
    && typeof createImageBitmap !== 'undefined' && Boolean(crypto.subtle);
}
export function createRunningUploadManager(userId: string, overrides: Partial<ManagerDependencies> = {}): UploadManager {
  const compatible = overrides.compatible ?? isUploadCompatible();
  const deps: ManagerDependencies = {
    api: photoUploadApi, process: processPhoto, precheck: precheckPhoto, fingerprint, validateSource: validateSourceFile, gps: extractLocation,
    online: () => navigator.onLine, phone: typeof matchMedia !== 'undefined' && matchMedia('(max-width: 640px) and (pointer: coarse)').matches,
    compatible,
    ...overrides,
    // Construct required browser primitives only when they are available.
    store: overrides.store ?? (compatible ? createMetadataStore(userId) : unavailableStore),
    locks: overrides.locks ?? navigator.locks,
    channel: overrides.channel ?? (compatible ? new BroadcastChannel(`traveled-uploads-${userId}`) : unavailableChannel),
  };
  const account = `traveled-uploads-${userId}`;
  const pools = new ResourcePools(deps.locks, account, deviceLimits(deps.phone));
  const lifetime = new AbortController();
  const metadata = new Map<string, UploadMetadata>();
  const items = new Map<string, UploadItem>();
  const files = new Map<string, File>();
  const targets = new Map<string, UploadTarget>();
  const checked = new Set<string>();
  const running = new Map<string, AbortController>();
  const listeners = new Set<() => void>();
  let lastGrantAt = Date.now();
  let snapshot: UploadSnapshot = { items: [], error: compatible ? null : 'Photo uploading requires Web Locks, IndexedDB, workers, and canvas support. Use a current supported browser.', compatible };
  const emit = () => {
    if (lifetime.signal.aborted) return;
    snapshot = { ...snapshot, items: [...items.values()].filter(item => !item.outcome || !metadata.get(item.id)?.dismissed) };
    for (const listener of listeners) listener();
  };
  const local = (id: string, status: UploadItem['local_status'], error: string | null = null, failure?: FailureContext) => {
    if (lifetime.signal.aborted) return;
    const item = items.get(id);
    if (status === 'failed' && failure && (item?.generation !== failure.generation || item.phase !== failure.stage)) return;
    if (item) { items.set(id, { ...item, local_status: status, local_error: error }); emit(); }
    const value = metadata.get(id);
    if (value && (status === 'failed' || value.localFailed)) {
      value.localFailed = status === 'failed'; value.localError = error;
      value.localFailureGeneration = status === 'failed' ? failure?.generation ?? item?.generation : undefined;
      value.localFailureStage = status === 'failed' ? failure?.stage ?? item?.phase : undefined;
      void deps.store.put(value).catch(() => undefined);
    }
  };
  async function save(submission: UploadSubmission) {
    if (lifetime.signal.aborted || submission.user_id !== userId) return;
    const previous = metadata.get(submission.id);
    const value: UploadMetadata = {
      submission, admissionRequest: previous?.admissionRequest ?? submission.id,
      candidateRequest: previous?.candidateRequest ?? null,
      originalAcknowledged: previous?.originalAcknowledged ?? submission.phase !== 'original_upload',
      dismissed: previous?.dismissed,
      localFailed: previous?.localFailed && (previous.localFailureGeneration === undefined || previous.localFailureGeneration === submission.generation)
        && (previous.localFailureStage === undefined || previous.localFailureStage === submission.phase),
      localError: previous?.localError, localFailureGeneration: previous?.localFailureGeneration, localFailureStage: previous?.localFailureStage,
    };
    metadata.set(submission.id, value);
    const previousItem = items.get(submission.id);
    const clearedFailure = previous?.localFailed && !value.localFailed;
    if (clearedFailure) value.localError = null;
    items.set(submission.id, { ...submission, local_status: value.localFailed ? 'failed' : clearedFailure ? 'waiting' : previousItem?.local_status ?? 'waiting',
      local_error: clearedFailure ? null : value.localError ?? previousItem?.local_error ?? null, local_warning: previousItem?.local_warning });
    if (submission.outcome) {
      files.delete(submission.id); targets.delete(submission.id);
      items.set(submission.id, { ...items.get(submission.id)!, local_status: null, local_error: null });
    }
    const persisted = await deps.store.put(value);
    // A concurrent Clear in another tab can be merged by the storage transaction.
    // Apply that durable dismissal before publishing the refreshed result.
    if (persisted?.dismissed) {
      const current = metadata.get(submission.id);
      if (current) current.dismissed = true;
    }
    emit();
  }
  async function request(body: UploadRequest) {
    if (lifetime.signal.aborted) throw new StoppedUpload();
    const response = await deps.api.request(body);
    if (lifetime.signal.aborted) throw new StoppedUpload();
    if (response.submission) await save(response.submission);
    if (lifetime.signal.aborted) throw new StoppedUpload();
    if (response.target && 'id' in body) targets.set(body.id, response.target);
    return response;
  }
  async function reconcile(id: string) { await request({ action: 'reconcile', id }); return items.get(id); }
  async function waitOnline(signal: AbortSignal) {
    while (!deps.online()) { await pause(1000, signal); }
  }
  async function retryOperation<T>(id: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    let attempts = 0;
    for (;;) {
      await waitOnline(signal);
      if (signal.aborted) throw new StoppedUpload();
      try { return await work(); }
      catch (error) {
        if (signal.aborted || error instanceof StoppedUpload) throw error;
        // Connectivity pauses do not consume the automatic retry budget.
        if (!deps.online()) {
          await waitOnline(signal);
          try { await reconcile(id); } catch { /* A lost admission may not exist yet. */ }
          if (items.get(id)?.outcome) throw new StoppedUpload();
          continue;
        }
        if (error instanceof UploadApiError && error.pause_reason) {
          const item = items.get(id);
          if (item) items.set(id, { ...item, pause_reason: error.pause_reason });
          local(id, 'waiting', error.message);
          await pause(2000, signal);
          // Admission may not yet exist: retry its stable identity, without spending
          // a technical attempt, once capacity or the operator pause is released.
          try { await reconcile(id); } catch { /* The next admission reconciles this identity. */ }
          if (items.get(id)?.outcome) throw new StoppedUpload();
          continue;
        }
        if (error instanceof UploadApiError && !error.retryable) throw error;
        if (attempts >= UPLOAD_LIMITS.automaticRetries) throw error;
        attempts++;
        local(id, 'waiting', 'Temporary upload problem. Retrying…');
        const minimum = Math.max(0, Date.parse(items.get(id)?.retry_at ?? '') - Date.now()) || 0;
        await pause(retryDelay(attempts, Math.random, minimum), signal);
        try { await reconcile(id); } catch { /* An unacknowledged admission is retried with the same ID. */ }
        if (items.get(id)?.outcome) throw new StoppedUpload();
        local(id, 'working');
      }
    }
  }
  async function work(id: string, signal: AbortSignal, failure: { current: FailureContext | null }) {
    let item: UploadItem | undefined;
    try { item = await reconcile(id); }
    catch (error) {
      const pending = items.get(id), file = files.get(id), value = metadata.get(id);
      if (!pending || pending.phase !== 'original_upload' || !file || !value) throw error;
      failure.current = { stage: 'original_upload', generation: pending.generation };
      await retryOperation(id, signal, () => request({ action: 'admit', id, request_id: value.admissionRequest, trip_id: pending.trip_id,
        filename: file.name, source_sha256: pending.source_sha256!, source_bytes: file.size }));
      item = items.get(id);
    }
    if (!item || item.outcome || item.pause_reason || (item.retry_at && Date.parse(item.retry_at) > Date.now())) return;
    if (['original_upload', 'gps', 'processing', 'candidate_upload'].includes(item.phase))
      failure.current = { stage: item.phase as BrowserStage, generation: item.generation };
    if (item.phase === 'original_upload') {
      const file = files.get(id);
      if (!file) { local(id, 'needs_file'); return; }
      if (!checked.has(id)) {
        // The result is advisory only and never changes admission or authoritative verdicts.
        try {
          const result = await pools.run('processing', signal, () => deps.precheck?.(file, signal) ?? Promise.resolve(null));
          if (result) { const current = items.get(id); if (current) { items.set(id, { ...current, local_warning: 'This photo may contain sensitive content. Awaiting the server check.' }); emit(); } }
        }
        catch { /* An optional model/backend failure cannot block upload. */ }
        checked.add(id);
      }
      const value = metadata.get(id)!;
      await retryOperation(id, signal, async () => {
        const current = await reconcile(id);
        if (current?.phase !== 'original_upload') return;
        const response = await request({ action: 'admit', id, request_id: value.admissionRequest, trip_id: item!.trip_id,
          filename: file.name, source_sha256: item!.source_sha256!, source_bytes: file.size });
        const target = response.target ?? targets.get(id);
        if (!target) throw new Error('The original upload destination is unavailable.');
        // A lost acknowledgment is checked before another immutable upload is attempted.
        if (!value.originalAcknowledged) {
          try { await pools.run('upload', signal, () => deps.api.transfer(target, file)); }
          catch (error) {
            // Immutable Storage may already contain the bytes after a lost response. Let the
            // trusted acknowledgment verify the object; a duplicate-upload error is not success.
            try { await request({ action: 'original_uploaded', id }); }
            catch { throw error; }
            return;
          }
          value.originalAcknowledged = true;
          metadata.set(id, value);
          await deps.store.put(value);
        }
        await request({ action: 'original_uploaded', id });
      });
      return;
    }
    if (!['gps', 'processing', 'candidate_upload'].includes(item.phase)) return;
    let source: File | undefined = files.get(id);
    if (!source) {
      const recovered = await retryOperation(id, signal, async () => {
        const response = await request({ action: 'recover', id });
        if (!response.recovery_path) return null;
        return pools.run('upload', signal, () => deps.api.recover(response.recovery_path!));
      });
      if (!recovered) { local(id, 'needs_file'); return; }
      source = new File([recovered], item.filename || 'photo', { type: recovered.type });
      if (source.size !== item.source_bytes || await deps.fingerprint(source) !== item.source_sha256)
        throw new Error('The recovered original does not match this submission.');
      files.set(id, source);
    }
    if (!item.gps_acknowledged) {
      failure.current = { stage: 'gps', generation: item.generation };
      let coordinates: { latitude: number | null; longitude: number | null };
      try { coordinates = await deps.gps(source); }
      catch { coordinates = { latitude: null, longitude: null }; }
      await retryOperation(id, signal, () => request({ action: 'gps', id, ...coordinates }));
    }
    // Reserve 8 MiB before processing. Hold this cross-tab buffer slot through candidate upload/retries.
    const releaseBuffer = await pools.acquire('buffer', signal);
    try {
      item = await reconcile(id);
      if (!item || item.outcome || !item.gps_acknowledged || !['processing', 'candidate_upload'].includes(item.phase)) return;
      failure.current = { stage: item.phase as BrowserStage, generation: item.generation };
      const candidate = await retryOperation(id, signal, () => pools.run('processing', signal, () => deps.process(source!, signal)));
      if (candidate.type !== 'image/webp' || candidate.size > UPLOAD_LIMITS.candidateBytes)
        throw new Error('The optimized photo must be WebP and no larger than 8 MiB.');
      const digest = await deps.fingerprint(candidate);
      const value = metadata.get(id)!;
      // This newly generated Blob has no durable byte identity. A recovered/reprocessed
      // candidate gets a new generation; retries of this retained Blob reuse its request.
      value.candidateRequest = crypto.randomUUID(); await deps.store.put(value);
      let transferred = false;
      await retryOperation(id, signal, async () => {
        const current = await reconcile(id);
        if (!current || current.outcome || !['processing', 'candidate_upload'].includes(current.phase)) return;
        const response = await request({ action: 'candidate', id, request_id: value.candidateRequest! });
        const target = response.target;
        if (!target) throw new Error('The candidate upload destination is unavailable.');
        failure.current = { stage: 'candidate_upload', generation: target.generation };
        if (!transferred) {
          try { await pools.run('upload', signal, () => deps.api.transfer(target, candidate)); }
          catch (error) {
            try { await request({ action: 'candidate_uploaded', id, generation: target.generation, sha256: digest, bytes: candidate.size }); }
            catch { throw error; }
            return;
          }
          transferred = true;
        }
        await request({ action: 'candidate_uploaded', id, generation: target.generation, sha256: digest, bytes: candidate.size });
      });
      files.delete(id);
    } finally { releaseBuffer(); }
  }
  function dispatch(ids: string[]) {
    for (const id of ids) {
      if (running.has(id) || items.get(id)?.local_status === 'failed' || lifetime.signal.aborted || !deps.online()) continue;
      if (items.get(id)?.phase === 'original_upload' && !files.has(id)) { local(id, 'needs_file'); continue; }
      const controller = new AbortController(); running.set(id, controller);
      const abort = () => controller.abort(); lifetime.signal.addEventListener('abort', abort, { once: true });
      void deps.locks.request(`${account}:item:${id}`, { ifAvailable: true }, async (lock) => {
        if (!lock || controller.signal.aborted) return;
        local(id, 'working');
        const failure: { current: FailureContext | null } = { current: null };
        try { await work(id, controller.signal, failure); if (items.get(id)?.local_status === 'working') local(id, 'waiting'); }
        catch (error) {
          if (!(error instanceof StoppedUpload) && !controller.signal.aborted) {
            const failed = failure.current;
            if (failed) {
              try { await request({ action: 'browser_failure', id, ...failed }); }
              catch { /* Local exhausted state remains durable until server reconciliation succeeds. */ }
            }
            const current = items.get(id);
            if (failed && current && (current.generation !== failed.generation || current.phase !== failed.stage)) local(id, 'waiting');
            else local(id, 'failed', error instanceof Error ? error.message : 'Photo upload failed.', failed ?? undefined);
          }
        }
      }).finally(() => { running.delete(id); lifetime.signal.removeEventListener('abort', abort); });
    }
  }
  async function refresh() {
    if (lifetime.signal.aborted) throw new StoppedUpload();
    for (const value of await deps.store.list()) {
      if (lifetime.signal.aborted) throw new StoppedUpload();
      const current = metadata.get(value.submission.id);
      if (value.submission.user_id === userId) {
        if (current) {
          current.localFailed = value.localFailed; current.localError = value.localError;
          current.localFailureGeneration = value.localFailureGeneration; current.localFailureStage = value.localFailureStage;
          current.dismissed = current.dismissed || value.dismissed;
        }
        else metadata.set(value.submission.id, value);
      }
    }
    const response = await request({ action: 'list' });
    for (const submission of response.submissions ?? []) await save(submission);
    // Match the server's seven-day finished-result window. Reconcile first so
    // unfinished recovery and pending cleanup are never discarded from stale data.
    const cutoff = Date.now() - UPLOAD_LIMITS.expiryDays * 86400000;
    for (const [id, value] of metadata) {
      if (lifetime.signal.aborted) throw new StoppedUpload();
      const submission = value.submission;
      if (!submission.outcome || submission.cleanup_pending || Date.parse(submission.created_at) > cutoff
        || !Number.isFinite(Date.parse(submission.created_at))) continue;
      await deps.store.remove(id);
      metadata.delete(id); items.delete(id); files.delete(id); targets.delete(id); checked.delete(id);
    }
    emit();
    return [...items.values()].filter((item) => !item.outcome && item.local_status !== 'failed').map((item) => item.id);
  }
  async function lead() {
    await deps.locks.request(`${account}:leader`, { signal: lifetime.signal }, async () => {
      while (!lifetime.signal.aborted) {
        try {
          await waitOnline(lifetime.signal);
          const ids = await refresh();
          if (lifetime.signal.aborted) return;
          // Grants contain identifiers only; each originating tab keeps its own File and does local work.
          grant(ids);
        } catch (error) {
          if (!lifetime.signal.aborted) { snapshot = { ...snapshot, error: error instanceof Error ? error.message : 'The upload queue is unavailable.' }; emit(); }
        }
        await pause(2000, lifetime.signal);
      }
    });
  }
  function grant(ids: string[]) {
    lastGrantAt = Date.now();
    deps.channel.postMessage({ type: 'grant', ids }); dispatch(ids);
    if (snapshot.error) { snapshot = { ...snapshot, error: null }; emit(); }
  }
  async function watchCoordinator() {
    while (!lifetime.signal.aborted) {
      await pause(2000, lifetime.signal);
      const canWork = [...items.values()].some(item => !item.outcome && item.local_status !== 'failed'
        && (item.phase !== 'original_upload' || files.has(item.id)));
      if (!canWork || !deps.online() || Date.now() - lastGrantAt < 10000) continue;
      // A frozen/background coordinator can retain its Web Lock without sending
      // grants. Coalesce fallback polling; existing per-item locks still prevent
      // duplicate transfers, and healthy grants suppress this extra work.
      await deps.locks.request(`${account}:coordinator-watchdog`, { ifAvailable: true }, async lock => {
        if (!lock || lifetime.signal.aborted || Date.now() - lastGrantAt < 10000) return;
        lastGrantAt = Date.now();
        try {
          const ids = await refresh();
          if (!lifetime.signal.aborted) grant(ids);
        } catch (error) {
          if (!lifetime.signal.aborted) {
            snapshot = { ...snapshot, error: error instanceof Error ? error.message : 'The upload queue is unavailable.' }; emit();
          }
        }
      });
    }
  }
  const ready = compatible ? (async () => {
    if (overrides.compatible === undefined) {
      try {
        const canvas = new OffscreenCanvas(1, 1);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas processing is unavailable.');
        context.fillRect(0, 0, 1, 1);
        // Safari uses the bundled WebP encoder in the worker. Only canvas
        // processing is required here; native WebP encoding is optional.
      } catch {
        snapshot = { ...snapshot, compatible: false, error: 'Your browser cannot process photos. Use a current supported browser.' };
        emit(); return;
      }
    }
    for (const value of await deps.store.list()) {
      if (lifetime.signal.aborted) return;
      if (value.submission.user_id === userId) { metadata.set(value.submission.id, value); await save(value.submission); }
    }
    try { await refresh(); }
    catch (error) { snapshot = { ...snapshot, error: error instanceof Error ? error.message : 'Upload recovery failed.' }; emit(); }
    if (lifetime.signal.aborted) return;
    deps.channel.onmessage = (event: MessageEvent<{ type?: string; ids?: string[] }>) => {
      if (event.data.type === 'grant' && Array.isArray(event.data.ids)) {
        lastGrantAt = Date.now();
        const ids = event.data.ids.filter((id) => typeof id === 'string');
        void refresh().then(() => dispatch(ids)).catch(() => undefined);
      }
    };
    void lead().catch(() => { /* Aborting a pending leader lock is expected on sign-out. */ });
    void watchCoordinator().catch(() => { /* Stopping the manager cancels the watchdog timer. */ });
  })().catch((error: unknown) => { snapshot = { ...snapshot, error: error instanceof Error ? error.message : 'Upload recovery failed.' }; emit(); }) : Promise.resolve();
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    async preview(source, signal) {
      if (!compatible) throw new Error(snapshot.error!);
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      lifetime.signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted || lifetime.signal.aborted) abort();
      try {
        // Previews share the upload processing slots, including across tabs.
        return await pools.run('processing', controller.signal, () => (deps.preview ?? previewPhoto)(source, controller.signal));
      } finally {
        signal.removeEventListener('abort', abort);
        lifetime.signal.removeEventListener('abort', abort);
      }
    },
    async clearFinished() {
      for (const item of snapshot.items) {
        if (!item.outcome || ['published', 'canceled', 'deleted'].includes(item.outcome)) continue;
        const value = metadata.get(item.id);
        if (!value) continue;
        const dismissed = { ...value, dismissed: true };
        await deps.store.put(dismissed);
        if (lifetime.signal.aborted) return;
        metadata.set(item.id, dismissed);
        emit();
      }
    },
    async enqueue(tripId, selected) {
      if (!compatible) throw new Error(snapshot.error!);
      await ready;
      if (!snapshot.compatible) throw new Error(snapshot.error!);
      await deps.locks.request(`${account}:admission`, async () => {
        await waitOnline(lifetime.signal);
        await refresh();
        const validCount = selected.filter((file) => file.size > 0 && file.size <= UPLOAD_LIMITS.originalBytes).length;
        if (activeCount() + validCount > UPLOAD_LIMITS.queue)
          throw new Error('The upload queue can hold at most 100 unfinished photos.');
        for (const file of selected) {
          const id = crypto.randomUUID(), admissionRequest = crypto.randomUUID();
          try { assertSourceSize(file.size); await deps.validateSource(file); }
          catch (error) {
            const invalid: UploadSubmission = { id, trip_id: tripId, user_id: userId, filename: file.name,
              phase: 'complete', outcome: 'invalid', generation: 0, created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + UPLOAD_LIMITS.expiryDays * 86400000).toISOString(),
              gps_acknowledged: false, latitude: null, longitude: null, source_sha256: null, source_bytes: file.size,
              retry_at: null, attempts: 0, error: error instanceof Error ? error.message : 'This file cannot be uploaded.', pause_reason: null, cleanup_pending: false };
            await save(invalid); continue;
          }
          const source_sha256 = await deps.fingerprint(file);
          const created_at = new Date().toISOString();
          const submission: UploadSubmission = { id, trip_id: tripId, user_id: userId, filename: file.name,
            phase: 'original_upload', outcome: null, generation: 0, created_at,
            expires_at: new Date(Date.now() + UPLOAD_LIMITS.expiryDays * 86400000).toISOString(),
            gps_acknowledged: false, latitude: null, longitude: null, source_sha256, source_bytes: file.size,
            retry_at: null, attempts: 0, error: null, pause_reason: null, cleanup_pending: false };
          metadata.set(id, { submission, admissionRequest, candidateRequest: null, originalAcknowledged: false });
          files.set(id, file); await save(submission);
          try { await request({ action: 'admit', id, request_id: admissionRequest, trip_id: tripId, filename: file.name, source_sha256, source_bytes: file.size }); }
          catch (error) {
            if (error instanceof UploadApiError && !error.retryable) {
              await save({ ...submission, phase: 'complete', outcome: error.status === 403 ? 'access_revoked' : 'invalid', error: error.message });
              files.delete(id);
            } else {
              if (error instanceof UploadApiError && error.pause_reason) items.set(id, { ...items.get(id)!, pause_reason: error.pause_reason });
              local(id, 'waiting', error instanceof Error ? error.message : 'Waiting to admit this photo.');
            }
            // Every selected file keeps its own stable identity; one admission failure
            // must not discard the rest of the user's selection.
          }
          // Server-admitted identity is now shared; processing starts on the leader's next grant.
        }
      });
    },
    async retry(id) {
      await ready;
      await deps.locks.request(`${account}:admission`, async () => {
        await refresh(); const item = items.get(id);
        if (!item || item.outcome) throw new Error('This submission cannot be retried.');
        if ((item.local_status === 'failed' || item.pause_reason === 'technical') && activeCount() >= UPLOAD_LIMITS.queue)
          throw new Error('The upload queue can hold at most 100 unfinished photos.');
        running.get(id)?.abort();
        local(id, 'waiting');
        const value = metadata.get(id);
        if (value) { value.localFailed = false; value.localError = null; await deps.store.put(value); }
        try { await request({ action: 'retry', id }); }
        catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (!(item.phase === 'original_upload' && value && !value.originalAcknowledged && /^(?:Submission access denied|Unknown submission)$/.test(message))) throw error;
          // No server stage exists for this exhausted pending admission. The next
          // leader grant retries its original stable admission instead of inventing an ID.
          if (!files.has(id)) local(id, 'needs_file');
        }
      });
    },
    async cancel(id) {
      running.get(id)?.abort(); files.delete(id); targets.delete(id);
      await request({ action: 'cancel', id }); local(id, null);
    },
    async reselect(id, file) {
      await ready;
      let item: UploadItem | undefined;
      try { item = await reconcile(id); }
      catch (error) {
        // A durable pending admission can exist only in metadata after a lost/offline
        // request. Reselect matching bytes before retrying that same identity.
        const pending = items.get(id);
        if (!pending || pending.phase !== 'original_upload' || pending.outcome) throw error;
        item = pending;
      }
      if (!item || item.outcome) throw new Error('This submission is no longer recoverable.');
      assertSourceSize(file.size);
      if (file.size !== item.source_bytes || await deps.fingerprint(file) !== item.source_sha256)
        throw new Error('Choose the same original photo to resume this submission.');
      files.set(id, file); local(id, 'waiting');
    },
    stop() {
      lifetime.abort(); for (const controller of running.values()) controller.abort();
      files.clear(); targets.clear(); checked.clear(); items.clear(); metadata.clear(); listeners.clear(); deps.channel.close();
      snapshot = { ...snapshot, items: [] };
    },
  };
  function activeCount() { return [...items.values()].filter((item) => !item.outcome && item.local_status !== 'failed' && item.pause_reason !== 'technical').length; }
}
const unavailableStore: MetadataStore = { list: async () => [], put: async () => undefined, remove: async () => undefined, clear: async () => undefined };
const unavailableChannel = { close() {}, postMessage() {}, onmessage: null } as unknown as BroadcastChannel;
