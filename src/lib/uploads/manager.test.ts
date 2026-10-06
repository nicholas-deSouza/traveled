import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUploadManager, type ManagerDependencies } from './manager';
import { fakeChannel, fakeLocks, memoryStore, submission } from './testHelpers';
import type { UploadPhase, UploadRequest, UploadResponse, UploadSubmission } from '../photoUploadContract';
import { UploadApiError } from './photoUploadApi';
vi.mock('./photoUploadApi', async (importOriginal) => ({ ...await importOriginal<typeof import('./photoUploadApi')>(), photoUploadApi: {} }));
vi.mock('./processor', () => ({ processPhoto: vi.fn(), precheckPhoto: vi.fn(async () => null) }));
vi.mock('../photoMetadata', () => ({ extractLocation: vi.fn() }));
const managers: ReturnType<typeof createUploadManager>[] = [];
afterEach(() => { for (const manager of managers) manager.stop(); managers.length = 0; vi.useRealTimers(); vi.unstubAllGlobals(); });
function harness(initial: UploadSubmission[] = []) {
  const server = new Map(initial.map((item) => [item.id, item]));
  const requests: UploadRequest[] = [];
  const store = memoryStore();
  const request = vi.fn(async (body: UploadRequest): Promise<UploadResponse> => {
    requests.push(body);
    if (body.action === 'list') return { submissions: [...server.values()] };
    if (body.action === 'admit') {
      const item = server.get(body.id) ?? submission({ id: body.id, source_bytes: body.source_bytes, source_sha256: body.source_sha256 });
      server.set(body.id, item);
      return { submission: item, target: { bucket: 'photo-quarantine', path: `original/${body.id}`, generation: 0 } };
    }
    const item = server.get(body.id);
    if (!item) throw new Error('Unknown submission');
    if (body.action === 'original_uploaded') item.phase = 'original_check';
    if (body.action === 'gps') { item.gps_acknowledged = true; item.phase = 'processing'; }
    if (body.action === 'candidate') { item.phase = 'candidate_upload'; item.generation = 1; return { submission: { ...item }, target: { bucket: 'photo-quarantine', path: `candidate/${body.id}`, generation: 1 } }; }
    if (body.action === 'candidate_uploaded') item.phase = 'candidate_check';
    if (body.action === 'cancel') { item.outcome = 'canceled'; item.phase = 'complete'; }
    if (body.action === 'browser_failure' && body.generation === item.generation && body.stage === item.phase) item.pause_reason = 'technical';
    if (body.action === 'retry') item.pause_reason = null;
    if (body.action === 'recover') return { recovery_path: `original/${body.id}` };
    return { submission: { ...item } };
  });
  const dependencies: ManagerDependencies = { api: { request, transfer: vi.fn(async () => undefined), recover: vi.fn(async () => new Blob(['abc'])) },
    store, locks: fakeLocks(), channel: fakeChannel(), process: vi.fn(async () => new Blob(['candidate'], { type: 'image/webp' })),
    fingerprint: vi.fn(async () => 'sha'), validateSource: vi.fn(async () => undefined), gps: vi.fn(async () => ({ latitude: null, longitude: null })),
    online: () => true, compatible: true, phone: false };
  const manager = createUploadManager('user', dependencies); managers.push(manager);
  return { manager, server, requests, dependencies, store };
}
async function flush() { for (let index = 0; index < 40; index++) await Promise.resolve(); }
const unfinishedStages: UploadPhase[] = ['original_upload', 'original_check', 'gps', 'processing', 'candidate_upload', 'candidate_check', 'publication'];
it('finishes an upload when another tab retains the coordinator lock without sending grants', async () => {
  vi.useFakeTimers();
  const { manager, dependencies, server, requests } = harness();
  let releaseCoordinator!: () => void;
  const frozenCoordinator = dependencies.locks.request('traveled-uploads-user:leader', async () => {
    await new Promise<void>(resolve => { releaseCoordinator = resolve; });
  });
  manager.start(); await flush();
  await manager.enqueue('trip', [new File(['abc'], 'photo.jpg')]);
  const id = manager.getSnapshot().items[0].id;
  await vi.advanceTimersByTimeAsync(8000);
  expect(dependencies.api.transfer).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2000); await flush();
  expect(server.get(id)?.phase).toBe('original_check');
  expect(dependencies.api.transfer).toHaveBeenCalledTimes(1);
  server.get(id)!.phase = 'gps';
  await vi.advanceTimersByTimeAsync(10000); await flush();
  expect(server.get(id)?.phase).toBe('candidate_check');
  expect(dependencies.api.transfer).toHaveBeenCalledTimes(2);
  Object.assign(server.get(id)!, { phase: 'complete', outcome: 'published' });
  await vi.advanceTimersByTimeAsync(10000); await flush();
  expect(manager.getSnapshot().items[0].outcome).toBe('published');
  expect(requests.some(request => request.action === 'browser_failure')).toBe(false);
  manager.stop(); releaseCoordinator(); await frozenCoordinator;
  const count = requests.length;
  await vi.advanceTimersByTimeAsync(20000);
  expect(requests).toHaveLength(count);
});
it('suppresses fallback polling while another coordinator keeps sending healthy grants', async () => {
  vi.useFakeTimers();
  const { manager, dependencies, requests } = harness([submission({ phase: 'original_check' })]);
  let releaseCoordinator!: () => void;
  const healthyCoordinator = dependencies.locks.request('traveled-uploads-user:leader', async () => {
    await new Promise<void>(resolve => { releaseCoordinator = resolve; });
  });
  manager.start(); await flush();
  for (let tick = 0; tick < 8; tick++) {
    dependencies.channel.onmessage?.({ data: { type: 'grant', ids: ['submission'] } } as MessageEvent);
    await flush(); await vi.advanceTimersByTimeAsync(2000);
  }
  expect(dependencies.channel.postMessage).not.toHaveBeenCalled();
  expect(requests.filter(request => request.action === 'list')).toHaveLength(9);
  expect(dependencies.api.transfer).not.toHaveBeenCalled();
  manager.stop(); releaseCoordinator(); await healthyCoordinator;
});
it('shares the phone processing slot between previews and releases it on selection removal', async () => {
  vi.useFakeTimers();
  const { manager, dependencies } = harness();
  dependencies.phone = true;
  dependencies.preview = vi.fn((_source, signal) => new Promise<Blob>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Preview canceled')), { once: true });
  }));
  manager.start(); await flush();
  const first = new AbortController(), second = new AbortController();
  const firstPreview = manager.preview(new Blob(['first']), first.signal);
  const firstRejected = expect(firstPreview).rejects.toThrow('Preview canceled');
  const secondPreview = manager.preview(new Blob(['second']), second.signal);
  const secondRejected = expect(secondPreview).rejects.toThrow('Preview canceled');
  await flush();
  expect(dependencies.preview).toHaveBeenCalledTimes(1);
  first.abort(); await firstRejected;
  await vi.advanceTimersByTimeAsync(100); await flush();
  expect(dependencies.preview).toHaveBeenCalledTimes(2);
  manager.stop(); await secondRejected;
  expect(dependencies.api.transfer).not.toHaveBeenCalled();
});
it('prunes old finished metadata after reconciliation while preserving recovery, cleanup and recent dismissals', async () => {
  vi.useFakeTimers();
  const old = new Date(Date.now() - 8 * 86400000).toISOString();
  const { manager, store, server, dependencies } = harness([
    submission({ id: 'recover', phase: 'original_check', created_at: old }),
    submission({ id: 'cleanup', phase: 'complete', outcome: 'canceled', created_at: old, cleanup_pending: true }),
    submission({ id: 'recent', phase: 'complete', outcome: 'rejected' }),
  ]);
  for (const item of [
    submission({ id: 'old-published', phase: 'complete', outcome: 'published', created_at: old }),
    submission({ id: 'old-local-invalid', phase: 'complete', outcome: 'invalid', created_at: old }),
    ...server.values(),
  ]) await store.put({ submission: item, admissionRequest: item.id, candidateRequest: null,
    originalAcknowledged: true, dismissed: item.outcome === 'rejected' || item.outcome === 'invalid' });
  // A stale local record says cleanup is complete; current server state must win.
  store.values.get('cleanup')!.submission.cleanup_pending = false;
  manager.start(); await flush();
  expect([...store.values.keys()].sort()).toEqual(['cleanup', 'recent', 'recover']);
  expect(manager.getSnapshot().items.map(item => item.id).sort()).toEqual(['cleanup', 'recover']);
  expect(store.values.get('recent')?.dismissed).toBe(true);
  manager.stop(); manager.start(); await flush();
  expect(store.values.has('old-local-invalid')).toBe(false);
  expect(store.values.get('recent')?.dismissed).toBe(true);
  server.get('cleanup')!.cleanup_pending = false;
  await vi.advanceTimersByTimeAsync(2500); await flush();
  expect(store.values.has('cleanup')).toBe(false);
  expect(store.values.has('recover')).toBe(true);
  expect(dependencies.api.transfer).not.toHaveBeenCalled();
});
it('dismisses only finished visible results and retains dismissal across polling and restart', async () => {
  vi.useFakeTimers();
  const { manager, requests, store } = harness([
    submission({ id: 'active', phase: 'original_check' }),
    submission({ id: 'invalid', phase: 'complete', outcome: 'invalid' }),
    submission({ id: 'published', phase: 'complete', outcome: 'published' }),
  ]);
  manager.start(); await flush();
  await manager.clearFinished();
  expect(manager.getSnapshot().items.map(item => item.id)).toEqual(['active', 'published']);
  expect(store.values.get('invalid')?.dismissed).toBe(true);
  expect(store.values.get('active')?.dismissed).not.toBe(true);
  await vi.advanceTimersByTimeAsync(2500); await flush();
  manager.stop(); manager.start(); await flush();
  expect(manager.getSnapshot().items.map(item => item.id)).toEqual(['active', 'published']);
  expect(requests.some(request => ['cancel', 'delete', 'retry'].includes(request.action))).toBe(false);
});
it('retains Clear after delayed logout and a fresh login, including local-only invalid results', async () => {
  vi.useFakeTimers();
  const { manager, dependencies, store } = harness([
    submission({ id: 'rejected', phase: 'complete', outcome: 'rejected' }),
    submission({ id: 'active', phase: 'original_check' }),
  ]);
  store.close = vi.fn();
  const clear = vi.spyOn(store, 'clear');
  vi.mocked(dependencies.validateSource).mockRejectedValueOnce(new Error('Invalid image'));
  manager.start(); await flush();
  await manager.enqueue('trip', [new File(['invalid'], 'invalid.jpg')]);
  const localId = manager.getSnapshot().items.find(item => item.filename === 'invalid.jpg')!.id;
  await manager.clearFinished();
  manager.stop();
  await vi.advanceTimersByTimeAsync(5000); await flush();
  expect(manager.getSnapshot().items).toEqual([]);
  expect(store.close).toHaveBeenCalledOnce();
  expect(clear).not.toHaveBeenCalled();
  expect(store.values.get(localId)?.dismissed).toBe(true);
  const relogged = createUploadManager('user', { ...dependencies, channel: fakeChannel() });
  managers.push(relogged); relogged.start(); await flush();
  await vi.advanceTimersByTimeAsync(4000); await flush();
  expect(relogged.getSnapshot().items.map(item => item.id)).toEqual(['active']);
  expect(store.values.get('rejected')?.dismissed).toBe(true);
});
it('keeps account dismissals isolated through account switch and return', async () => {
  vi.useFakeTimers();
  const { manager, dependencies, store } = harness([
    submission({ id: 'mine', phase: 'complete', outcome: 'invalid' }),
    submission({ id: 'theirs', user_id: 'other-user', phase: 'complete', outcome: 'invalid' }),
  ]);
  manager.start(); await flush(); await manager.clearFinished(); manager.stop();
  await vi.advanceTimersByTimeAsync(5000); await flush();
  // Include foreign cached rows to verify owner filtering at both store and API boundaries.
  const otherStore = memoryStore();
  await otherStore.put(store.values.get('mine')!);
  const other = createUploadManager('other-user', { ...dependencies, store: otherStore, channel: fakeChannel() });
  managers.push(other); other.start(); await flush();
  expect(other.getSnapshot().items.map(item => item.id)).toEqual(['theirs']);
  await other.clearFinished(); other.stop();
  await vi.advanceTimersByTimeAsync(5000); await flush();
  const returned = createUploadManager('user', { ...dependencies, channel: fakeChannel() });
  managers.push(returned); returned.start(); await flush();
  expect(returned.getSnapshot().items).toEqual([]);
  expect(store.values.has('theirs')).toBe(false);
  expect(otherStore.values.get('theirs')?.dismissed).toBe(true);
  expect(store.values.get('mine')?.dismissed).toBe(true);
});
it('does not resume stopped-account recovery when metadata resolves after logout', async () => {
  vi.useFakeTimers();
  const { manager, dependencies, store } = harness();
  let resolveList!: (values: Awaited<ReturnType<typeof store.list>>) => void;
  dependencies.store = { ...store, list: () => new Promise(resolve => { resolveList = resolve; }) };
  const delayed = createUploadManager('user', dependencies);
  managers.push(delayed); delayed.start(); manager.stop(); delayed.stop();
  await vi.advanceTimersByTimeAsync(5000);
  resolveList([{ submission: submission(), admissionRequest: 'stable', candidateRequest: null, originalAcknowledged: false }]);
  await flush();
  expect(delayed.getSnapshot().items).toEqual([]);
  expect(dependencies.api.request).not.toHaveBeenCalled();
  expect(dependencies.channel.onmessage).toBeNull();
  expect(store.values.size).toBe(0);
});
it('ignores a previous account list response arriving after delayed logout and account switch', async () => {
  vi.useFakeTimers();
  const { manager, dependencies, store } = harness([
    submission({ id: 'other-active', user_id: 'other-user', phase: 'original_check' }),
  ]);
  let resolveList!: (response: UploadResponse) => void;
  vi.mocked(dependencies.api.request).mockImplementationOnce(() => new Promise(resolve => { resolveList = resolve; }));
  manager.start(); await flush();
  expect(dependencies.api.request).toHaveBeenCalledWith({ action: 'list' });
  manager.stop(); await vi.advanceTimersByTimeAsync(5000); await flush();
  const other = createUploadManager('other-user', { ...dependencies, store: memoryStore(), channel: fakeChannel() });
  managers.push(other); other.start(); await flush();
  resolveList({ submissions: [submission({ id: 'late-old-account', phase: 'original_check' })] });
  await flush();
  expect(manager.getSnapshot().items).toEqual([]);
  expect(store.values.size).toBe(0);
  expect(dependencies.channel.onmessage).toBeNull();
  expect(dependencies.channel.postMessage).not.toHaveBeenCalled();
  expect(other.getSnapshot().items.map(item => item.id)).toEqual(['other-active']);
});
describe('interruption stage matrix (isolated server and browser resources)', () => {
  it.each(unfinishedStages)('cancels %s before reconnect and does not restart browser work', async (phase) => {
    vi.useFakeTimers();
    const { manager, dependencies, requests, server } = harness([submission({ phase, gps_acknowledged: phase !== 'gps' })]);
    let online = false; dependencies.online = () => online;
    manager.start(); await flush();
    await manager.cancel('submission');
    online = true; await vi.advanceTimersByTimeAsync(6000); await flush();
    expect(server.get('submission')).toMatchObject({ phase: 'complete', outcome: 'canceled' });
    expect(manager.getSnapshot().items[0]).toMatchObject({ id: 'submission', outcome: 'canceled', local_status: null });
    expect(dependencies.process).not.toHaveBeenCalled();
    expect(dependencies.api.transfer).not.toHaveBeenCalled();
    expect(requests.some(body => ['candidate', 'original_uploaded', 'candidate_uploaded', 'browser_failure'].includes(body.action))).toBe(false);
  });
  it.each(unfinishedStages)('restarts offline at %s with the same identity and resumes only eligible work', async (phase) => {
    vi.useFakeTimers();
    const { manager, dependencies, requests, store } = harness([submission({ phase,
      gps_acknowledged: ['processing', 'candidate_upload', 'candidate_check', 'publication'].includes(phase) })]);
    let online = false; dependencies.online = () => online;
    manager.start(); await flush(); manager.stop(); manager.start(); await flush();
    expect(manager.getSnapshot().items).toHaveLength(1);
    expect(manager.getSnapshot().items[0]).toMatchObject({ id: 'submission', phase });
    await vi.advanceTimersByTimeAsync(6000); await flush();
    expect(dependencies.api.transfer).not.toHaveBeenCalled();
    expect(dependencies.process).not.toHaveBeenCalled();
    expect(store.values.get('submission')?.submission.id).toBe('submission');
    online = true; await vi.advanceTimersByTimeAsync(2000); await flush();
    if (phase === 'original_upload') {
      expect(manager.getSnapshot().items[0].local_status).toBe('needs_file');
      await manager.reselect('submission', new File(['abc'], 'renamed-original.jpg'));
      await vi.advanceTimersByTimeAsync(2000); await flush();
      expect(manager.getSnapshot().items[0].phase).toBe('original_check');
      expect(dependencies.api.transfer).toHaveBeenCalledOnce();
    } else if (['gps', 'processing', 'candidate_upload'].includes(phase)) {
      expect(dependencies.api.recover).toHaveBeenCalledOnce();
      expect(dependencies.process).toHaveBeenCalledOnce();
      expect(dependencies.api.transfer).toHaveBeenCalledOnce();
      expect(manager.getSnapshot().items[0].phase).toBe('candidate_check');
    } else {
      expect(manager.getSnapshot().items[0].phase).toBe(phase);
      expect(dependencies.api.recover).not.toHaveBeenCalled();
      expect(dependencies.process).not.toHaveBeenCalled();
      expect(dependencies.api.transfer).not.toHaveBeenCalled();
    }
    expect(manager.getSnapshot().items).toHaveLength(1);
    expect(requests.filter(body => 'id' in body).every(body => 'id' in body && body.id === 'submission')).toBe(true);
    expect(requests.some(body => body.action === 'browser_failure')).toBe(false);
  });
  it('discards a processing result that arrives after cancellation', async () => {
    vi.useFakeTimers();
    const { manager, dependencies, requests } = harness([submission({ phase: 'processing', gps_acknowledged: true })]);
    let resolveProcess!: (blob: Blob) => void;
    let processingSignal: AbortSignal | undefined;
    vi.mocked(dependencies.process).mockImplementation((_source, signal) => {
      processingSignal = signal;
      return new Promise(resolve => { resolveProcess = resolve; });
    });
    manager.start(); await flush();
    expect(dependencies.process).toHaveBeenCalledOnce();
    await manager.cancel('submission');
    expect(processingSignal?.aborted).toBe(true);
    resolveProcess(new Blob(['late candidate'], { type: 'image/webp' }));
    await flush(); await vi.advanceTimersByTimeAsync(4000); await flush();
    expect(dependencies.api.transfer).not.toHaveBeenCalled();
    expect(requests.some(body => body.action === 'candidate' || body.action === 'candidate_uploaded')).toBe(false);
    expect(manager.getSnapshot().items[0].outcome).toBe('canceled');
  });
  it('clears stopped-account resources and excludes its submissions from the next account', async () => {
    vi.useFakeTimers();
    const { manager, dependencies, server, store } = harness([submission({ phase: 'original_check' })]);
    manager.start(); await flush(); manager.stop(); await vi.advanceTimersByTimeAsync(0); await flush();
    expect(manager.getSnapshot().items).toEqual([]);
    expect(store.values.has('submission')).toBe(true);
    expect(dependencies.channel.close).toHaveBeenCalledOnce();
    expect(server.has('submission')).toBe(true);
    server.set('other-submission', submission({ id: 'other-submission', user_id: 'other-user', phase: 'original_check' }));
    const other = createUploadManager('other-user', { ...dependencies, store: memoryStore(), channel: fakeChannel() });
    managers.push(other); other.start(); await flush();
    expect(other.getSnapshot().items.map(item => item.id)).toEqual(['other-submission']);
    expect(dependencies.api.transfer).not.toHaveBeenCalled();
  });
});
describe('in-flight connectivity and repeated retry flows', () => {
  const transferStages = [
    ['original', 'original_upload', 'original_check'],
    ['candidate', 'processing', 'candidate_check'],
  ] as const;
  it.each(transferStages)('reconnects during %s transfer without spending an automatic retry or changing its retained identity', async (kind, phase, completedPhase) => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const { manager, dependencies, requests, store } = harness([submission({ phase, gps_acknowledged: kind === 'candidate' })]);
    let online = true, uploaded = false;
    let rejectDisconnectedTransfer!: (error: Error) => void;
    dependencies.online = () => online;
    const originalRequest = dependencies.api.request;
    dependencies.api.request = vi.fn(async (body) => {
      // A failed transfer must not be mistaken for a successful immutable upload
      // by the manager's lost-response acknowledgment fallback.
      if (body.action === `${kind}_uploaded` && !uploaded)
        throw new UploadApiError('The object has not reached Storage', 503);
      return originalRequest(body);
    });
    const transfer = vi.mocked(dependencies.api.transfer);
    transfer.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectDisconnectedTransfer = reject; }));
    // All four connected retries must remain available after the offline failure.
    for (let attempt = 0; attempt < 4; attempt++)
      transfer.mockRejectedValueOnce(new UploadApiError('Temporary transfer failure', 503));
    transfer.mockImplementation(async () => { uploaded = true; });
    manager.start(); await flush();
    if (kind === 'original') await manager.reselect('submission', new File(['abc'], 'photo.jpg'));
    await vi.advanceTimersByTimeAsync(2000); await flush();
    expect(transfer).toHaveBeenCalledOnce();
    expect(manager.getSnapshot().items[0].local_status).toBe('working');

    // Connectivity changes only after the original/candidate transfer has begun.
    online = false;
    rejectDisconnectedTransfer(new UploadApiError('Network disconnected', 0));
    await flush(); await vi.advanceTimersByTimeAsync(60000); await flush();
    expect(transfer).toHaveBeenCalledOnce();
    expect(manager.getSnapshot().items[0].local_status).not.toBe('failed');
    expect(store.values.get('submission')?.localFailed).not.toBe(true);
    expect(requests.some(body => body.action === 'browser_failure')).toBe(false);

    online = true;
    await vi.advanceTimersByTimeAsync(33000); await flush();
    expect(transfer).toHaveBeenCalledTimes(6); // offline + four connected failures + success
    expect(manager.getSnapshot().items).toHaveLength(1);
    expect(manager.getSnapshot().items[0]).toMatchObject({ id: 'submission', phase: completedPhase, outcome: null, pause_reason: null });
    expect(store.values.get('submission')?.localFailed).not.toBe(true);
    expect(requests.some(body => body.action === 'browser_failure' || body.action === 'retry')).toBe(false);
    expect(requests.filter(body => 'id' in body).every(body => 'id' in body && body.id === 'submission')).toBe(true);
    const identities = requests.filter(body => body.action === (kind === 'original' ? 'admit' : 'candidate'));
    expect(identities).toHaveLength(6);
    expect(new Set(identities.map(body => 'request_id' in body ? body.request_id : null)).size).toBe(1);
    for (const [target, blob] of transfer.mock.calls) {
      expect(target).toEqual(transfer.mock.calls[0][0]);
      expect(blob).toBe(transfer.mock.calls[0][1]);
    }
    expect(dependencies.process).toHaveBeenCalledTimes(kind === 'candidate' ? 1 : 0);
    await vi.advanceTimersByTimeAsync(10000); await flush();
    expect(transfer).toHaveBeenCalledTimes(6);
  });
  it.each(transferStages)('keeps %s identity through repeated exhausted/manual retries and never overlaps a held transfer', async (kind, phase, completedPhase) => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const { manager, dependencies, requests, store } = harness([submission({ phase, gps_acknowledged: kind === 'candidate' })]);
    let uploaded = false, activeTransfers = 0, peakTransfers = 0;
    let releaseTransfer!: () => void;
    const originalRequest = dependencies.api.request;
    dependencies.api.request = vi.fn(async (body) => {
      if (body.action === `${kind}_uploaded` && !uploaded)
        throw new UploadApiError('The object has not reached Storage', 503);
      return originalRequest(body);
    });
    const transfer = vi.mocked(dependencies.api.transfer);
    transfer.mockImplementation(async () => {
      activeTransfers++; peakTransfers = Math.max(peakTransfers, activeTransfers);
      try {
        if (transfer.mock.calls.length <= 10) throw new UploadApiError('Temporary transfer failure', 503);
        await new Promise<void>(resolve => { releaseTransfer = resolve; });
        uploaded = true;
      } finally { activeTransfers--; }
    });
    manager.start(); await flush();
    if (kind === 'original') await manager.reselect('submission', new File(['abc'], 'photo.jpg'));
    for (let cycle = 1; cycle <= 2; cycle++) {
      await vi.advanceTimersByTimeAsync(35000); await flush();
      expect(transfer).toHaveBeenCalledTimes(cycle * 5);
      expect(manager.getSnapshot().items[0]).toMatchObject({ id: 'submission', local_status: 'failed', pause_reason: 'technical' });
      expect(store.values.get('submission')?.localFailed).toBe(true);
      await vi.advanceTimersByTimeAsync(10000); await flush();
      expect(transfer).toHaveBeenCalledTimes(cycle * 5);
      // Multiple clicks must reset the same submission, not admit extra records.
      await Promise.all([manager.retry('submission'), manager.retry('submission'), manager.retry('submission')]);
      expect(store.values.get('submission')?.localFailed).toBe(false);
    }
    await vi.advanceTimersByTimeAsync(2000); await flush();
    expect(transfer).toHaveBeenCalledTimes(11);
    expect(activeTransfers).toBe(1);
    await Promise.all([manager.retry('submission'), manager.retry('submission'), manager.retry('submission')]);
    // The underlying immutable transfer deliberately ignores abort until it settles.
    // Polls/grants must not dispatch another owner while this one still holds its lock.
    dependencies.channel.onmessage?.({ data: { type: 'grant', ids: ['submission'] } } as MessageEvent);
    await vi.advanceTimersByTimeAsync(10000); await flush();
    expect(transfer).toHaveBeenCalledTimes(11);
    expect(activeTransfers).toBe(1);
    expect(peakTransfers).toBe(1);
    releaseTransfer(); await flush(); await vi.advanceTimersByTimeAsync(4000); await flush();
    expect(activeTransfers).toBe(0);
    expect(transfer).toHaveBeenCalledTimes(11);
    expect(manager.getSnapshot().items).toHaveLength(1);
    expect(manager.getSnapshot().items[0]).toMatchObject({ id: 'submission', phase: completedPhase, outcome: null, pause_reason: null });
    expect(store.values.size).toBe(1);
    expect(store.values.get('submission')?.localFailed).toBe(false);
    expect(requests.filter(body => body.action === 'browser_failure')).toHaveLength(2);
    expect(requests.filter(body => body.action === 'retry')).toHaveLength(9);
    expect(requests.filter(body => 'id' in body).every(body => 'id' in body && body.id === 'submission')).toBe(true);
    const identities = requests.filter(body => body.action === (kind === 'original' ? 'admit' : 'candidate'));
    expect(identities).toHaveLength(11);
    const requestIds = identities.map(body => 'request_id' in body ? body.request_id : null);
    if (kind === 'original') expect(new Set(requestIds).size).toBe(1);
    else {
      // Each retained candidate reuses its generation request, but reprocessing
      // after manual retry must allocate a fresh request for the newly made Blob.
      expect(new Set(requestIds.slice(0, 5)).size).toBe(1);
      expect(new Set(requestIds.slice(5, 10)).size).toBe(1);
      expect(new Set([requestIds[0], requestIds[5], requestIds[10]]).size).toBe(3);
    }
    for (const start of [0, 5])
      for (const [, blob] of transfer.mock.calls.slice(start, start + 5)) expect(blob).toBe(transfer.mock.calls[start][1]);
    expect(dependencies.process).toHaveBeenCalledTimes(kind === 'candidate' ? 3 : 0);
  });
});
describe('browser canvas capability check', () => {
  function probeHarness(type = 'image/webp', contextAvailable = true) {
    const draw = vi.fn();
    class ProbeCanvas {
      initialized = false;
      getContext(kind: string) {
        this.initialized = kind === '2d' && contextAvailable;
        return this.initialized ? { fillRect: draw } : null;
      }
      async convertToBlob() {
        if (!this.initialized || !draw.mock.calls.length) throw new Error('The canvas is not initialized');
        return new Blob(['encoded'], { type });
      }
    }
    vi.stubGlobal('OffscreenCanvas', ProbeCanvas);
    vi.stubGlobal('Worker', class {});
    vi.stubGlobal('createImageBitmap', vi.fn());
    vi.stubGlobal('indexedDB', {});
    vi.stubGlobal('BroadcastChannel', class {});
    vi.stubGlobal('navigator', { locks: fakeLocks() });
    vi.stubGlobal('crypto', { subtle: {} });
    const { dependencies } = harness();
    const manager = createUploadManager('user', { ...dependencies, compatible: undefined });
    managers.push(manager);
    return { manager, draw, dependencies };
  }
  it('initializes and draws the probe before encoding, allowing a supported browser to start', async () => {
    const { manager, draw, dependencies } = probeHarness();
    manager.start(); await flush();
    expect(draw).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(manager.getSnapshot().compatible).toBe(true);
    expect(manager.getSnapshot().error).toBeNull();
    expect(dependencies.api.request).toHaveBeenCalledWith({ action: 'list' });
  });
  it('allows Safari canvas support without requiring native WebP encoding', async () => {
    const { manager, dependencies } = probeHarness('image/png');
    manager.start(); await flush();
    expect(manager.getSnapshot().compatible).toBe(true);
    expect(dependencies.api.request).toHaveBeenCalledWith({ action: 'list' });
  });
  it('blocks uploads when the 2D canvas context is unavailable', async () => {
    const { manager, dependencies } = probeHarness('image/webp', false);
    manager.start(); await flush();
    expect(manager.getSnapshot().compatible).toBe(false);
    expect(manager.getSnapshot().error).toContain('cannot process photos');
    expect(dependencies.api.request).not.toHaveBeenCalled();
  });
});
describe('upload lifecycle', () => {
  it('constructs without effects and supports StrictMode start/stop/start', async () => {
    const { manager, dependencies } = harness();
    expect(dependencies.api.request).not.toHaveBeenCalled();
    manager.start(); await flush(); manager.stop(); manager.start(); await flush();
    expect(dependencies.api.request).toHaveBeenCalledWith({ action: 'list' });
  });
  it('keeps stable identity, waits for server approval, acknowledges GPS before processing, and persists metadata only', async () => {
    vi.useFakeTimers();
    const { manager, server, requests, dependencies, store } = harness();
    manager.start(); await flush();
    await manager.enqueue('trip', [new File(['abc'], 'photo.jpg', { type: 'image/jpeg' })]);
    await vi.advanceTimersByTimeAsync(2000); await flush();
    const id = manager.getSnapshot().items[0].id;
    expect(server.get(id)?.phase).toBe('original_check');
    expect(dependencies.process).not.toHaveBeenCalled();
    server.get(id)!.phase = 'gps';
    await vi.advanceTimersByTimeAsync(2000); await flush();
    expect(server.get(id)?.phase).toBe('candidate_check');
    expect(requests.findIndex((body) => body.action === 'gps')).toBeLessThan(requests.findIndex((body) => body.action === 'candidate'));
    expect(manager.getSnapshot().items[0].outcome).toBeNull();
    expect(JSON.stringify([...store.values.values()])).not.toContain('candidate"');
    expect([...store.values.values()].every((value) => !Object.values(value).some((field) => field instanceof Blob))).toBe(true);
    expect(requests.filter((body) => body.action === 'admit').every((body) => body.id === id)).toBe(true);
  });
  it('rejects a different reselected original and accepts only matching bytes and fingerprint', async () => {
    const { manager, dependencies } = harness([submission()]); manager.start(); await flush();
    await expect(manager.reselect('submission', new File(['wrong'], 'same-name.jpg'))).rejects.toThrow('same original');
    vi.mocked(dependencies.fingerprint).mockResolvedValueOnce('different');
    await expect(manager.reselect('submission', new File(['abc'], 'photo.jpg'))).rejects.toThrow('same original');
    await manager.reselect('submission', new File(['abc'], 'renamed.jpg'));
    expect(manager.getSnapshot().items[0].local_status).toBe('waiting');
  });
  it.each(['request', 'download'] as const)('resumes after a transient recovery %s failure without reporting an exhausted upload', async (operation) => {
    vi.useFakeTimers();
    const { manager, dependencies, server, requests } = harness([submission({ phase: 'processing', gps_acknowledged: true })]);
    let recoverRequests = 0;
    const original = dependencies.api.request;
    dependencies.api.request = vi.fn(async (body) => {
      if (body.action === 'recover' && ++recoverRequests === 1 && operation === 'request')
        throw new UploadApiError('Recovery temporarily unavailable', 503);
      return original(body);
    });
    if (operation === 'download') vi.mocked(dependencies.api.recover).mockRejectedValueOnce(new UploadApiError('Storage temporarily unavailable', 503));
    manager.start(); await flush();
    expect(manager.getSnapshot().items[0].local_status).toBe('waiting');
    expect(dependencies.process).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000); await flush();
    expect(recoverRequests).toBe(2);
    expect(dependencies.api.recover).toHaveBeenCalledTimes(operation === 'download' ? 2 : 1);
    expect(server.get('submission')?.phase).toBe('candidate_check');
    expect(server.get('submission')?.pause_reason).toBeNull();
    expect(requests.some((body) => body.action === 'browser_failure')).toBe(false);
  });
  it('reports recovery failure only after the initial download and four automatic retries', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const { manager, dependencies, requests } = harness([submission({ phase: 'processing', generation: 1, gps_acknowledged: true })]);
    vi.mocked(dependencies.api.recover).mockRejectedValue(new UploadApiError('Storage temporarily unavailable', 503));
    manager.start(); await flush();
    await vi.advanceTimersByTimeAsync(33000); await flush();
    expect(dependencies.api.recover).toHaveBeenCalledTimes(5);
    expect(dependencies.process).not.toHaveBeenCalled();
    expect(manager.getSnapshot().items[0].local_status).toBe('failed');
    expect(requests).toContainEqual({ action: 'browser_failure', id: 'submission', generation: 1, stage: 'processing' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(dependencies.api.recover).toHaveBeenCalledTimes(5);
    vi.restoreAllMocks();
  });
  it('stops recovery retries when the submission is canceled during backoff', async () => {
    vi.useFakeTimers();
    const { manager, dependencies, requests } = harness([submission({ phase: 'processing', gps_acknowledged: true })]);
    vi.mocked(dependencies.api.recover).mockRejectedValue(new UploadApiError('Storage temporarily unavailable', 503));
    manager.start(); await flush();
    await manager.cancel('submission');
    await vi.advanceTimersByTimeAsync(10000); await flush();
    expect(dependencies.api.recover).toHaveBeenCalledOnce();
    expect(dependencies.process).not.toHaveBeenCalled();
    expect(requests.some((body) => body.action === 'browser_failure')).toBe(false);
    expect(manager.getSnapshot().items[0].outcome).toBe('canceled');
  });
  it('rejects recovered bytes whose fingerprint does not match the submission', async () => {
    const { manager, dependencies } = harness([submission({ phase: 'processing', gps_acknowledged: true })]);
    vi.mocked(dependencies.fingerprint).mockResolvedValue('wrong-source');
    manager.start(); await flush();
    expect(dependencies.api.recover).toHaveBeenCalledOnce();
    expect(dependencies.process).not.toHaveBeenCalled();
    expect(manager.getSnapshot().items[0]).toMatchObject({ local_status: 'failed', local_error: 'The recovered original does not match this submission.' });
  });
  it('blocks admission on unsupported browsers and prevents admission above 100 unresolved submissions', async () => {
    const unsupported = createUploadManager('user', { compatible: false }); managers.push(unsupported); unsupported.start();
    await expect(unsupported.enqueue('trip', [])).rejects.toThrow('Web Locks');
    const { manager } = harness(Array.from({ length: 100 }, (_, index) => submission({ id: `id-${index}` })));
    manager.start(); await flush();
    await expect(manager.enqueue('trip', [new File(['abc'], 'photo.jpg')])).rejects.toThrow('100');
  });
  it('pauses offline without transferring and clears browser state on stop', async () => {
    vi.useFakeTimers(); const { manager, dependencies } = harness([submission()]);
    dependencies.online = () => false; manager.start(); await flush();
    await vi.advanceTimersByTimeAsync(10000);
    expect(dependencies.api.transfer).not.toHaveBeenCalled(); manager.stop();
    expect(manager.getSnapshot().items).toEqual([]);
  });
  it('continues a selection after an invalid file and shows that per-file outcome', async () => {
    const { manager, server } = harness(); manager.start(); await flush();
    await manager.enqueue('trip', [new File([], 'empty.jpg'), new File(['abc'], 'valid.jpg')]);
    expect(manager.getSnapshot().items.find((item) => item.filename === 'empty.jpg')?.outcome).toBe('invalid');
    expect(server.size).toBe(1);
  });
  it('rejects an unsupported source before admission and continues the valid selection', async () => {
    const { manager, server, dependencies, requests } = harness(); manager.start(); await flush();
    vi.mocked(dependencies.validateSource).mockRejectedValueOnce(new Error('Choose a still JPEG, PNG, WebP, or HEIC photo.'));
    await manager.enqueue('trip', [new File(['text'], 'unsupported.txt'), new File(['abc'], 'valid.jpg')]);
    expect(manager.getSnapshot().items.find(item => item.filename === 'unsupported.txt')).toMatchObject({
      outcome: 'invalid', phase: 'complete', cleanup_pending: false, error: expect.stringContaining('still JPEG'),
    });
    expect(server.size).toBe(1);
    expect(requests.filter(request => request.action === 'admit')).toHaveLength(1);
    expect(dependencies.fingerprint).toHaveBeenCalledOnce();
    expect(dependencies.api.transfer).not.toHaveBeenCalled();
  });
  it('retries processing four times, frees workers during delays, and retains a visible exhausted failure', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const { manager, dependencies } = harness([submission({ phase: 'processing', gps_acknowledged: true })]);
    vi.mocked(dependencies.process).mockRejectedValue(new Error('Decoder temporarily unavailable'));
    manager.start(); await flush();
    await vi.advanceTimersByTimeAsync(35000); await flush();
    expect(dependencies.process).toHaveBeenCalledTimes(5);
    expect(manager.getSnapshot().items[0].local_status).toBe('failed');
    expect(dependencies.api.request).toHaveBeenCalledWith({ action: 'browser_failure', id: 'submission', generation: 0, stage: 'processing' });
    await vi.advanceTimersByTimeAsync(10000);
    expect(dependencies.process).toHaveBeenCalledTimes(5);
    vi.mocked(dependencies.process).mockResolvedValue(new Blob(['candidate'], { type: 'image/webp' }));
    await manager.retry('submission'); await vi.advanceTimersByTimeAsync(2000); await flush();
    expect(dependencies.process).toHaveBeenCalledTimes(6);
    vi.restoreAllMocks();
  });
  it('does not consume active capacity for exhausted technical failures, and retry reacquires it', async () => {
    const records = [submission({ id: 'failed', pause_reason: 'technical' }), ...Array.from({ length: 99 }, (_, index) => submission({ id: `active-${index}` }))];
    const { manager } = harness(records); manager.start(); await flush();
    await manager.enqueue('trip', [new File(['abc'], 'new.jpg')]);
    await expect(manager.retry('failed')).rejects.toThrow('100');
  });
  it('lets an originating follower transfer its file while the leader retains only metadata', async () => {
    vi.useFakeTimers();
    const { manager: leader, dependencies } = harness();
    const leaderChannel = dependencies.channel;
    const followerChannel = fakeChannel();
    vi.mocked(leaderChannel.postMessage).mockImplementation((data) => followerChannel.onmessage?.({ data } as MessageEvent));
    const follower = createUploadManager('user', { ...dependencies, channel: followerChannel }); managers.push(follower);
    leader.start(); follower.start(); await flush();
    await follower.enqueue('trip', [new File(['abc'], 'follower.jpg', { type: 'image/jpeg' })]);
    await vi.advanceTimersByTimeAsync(2000); await flush();
    expect(dependencies.api.transfer).toHaveBeenCalledOnce();
    expect(leader.getSnapshot().items[0].phase).toBe('original_upload');
    expect(follower.getSnapshot().items[0].phase).toBe('original_check');
    expect(vi.mocked(leaderChannel.postMessage).mock.calls.every(([message]) =>
      Object.keys(message).every((key) => ['type', 'ids'].includes(key)))).toBe(true);
  });
  it('allocates a fresh generation request when a recovered candidate must be reprocessed', async () => {
    vi.useFakeTimers();
    const { manager, requests, store } = harness([submission({ phase: 'candidate_upload', generation: 1, gps_acknowledged: true })]);
    await store.put({ submission: submission({ phase: 'candidate_upload', generation: 1, gps_acknowledged: true }),
      admissionRequest: 'admission', candidateRequest: 'previous-lost-buffer', originalAcknowledged: true });
    manager.start(); await flush();
    await vi.advanceTimersByTimeAsync(2000); await flush();
    const candidate = requests.find((body) => body.action === 'candidate');
    expect(candidate?.action === 'candidate' ? candidate.request_id : null).not.toBe('previous-lost-buffer');
  });
  it('reports the failed operation generation, so an old candidate cannot pause a newer generation', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const { manager, requests, dependencies, server } = harness([submission({ phase: 'candidate_upload', generation: 1, gps_acknowledged: true })]);
    let attempts = 0;
    vi.mocked(dependencies.process).mockImplementation(async () => {
      attempts++;
      if (attempts === 5) server.get('submission')!.generation = 2;
      throw new Error('Old-generation decoder failed');
    });
    manager.start(); await flush(); await vi.advanceTimersByTimeAsync(31000); await flush();
    expect(requests).toContainEqual({ action: 'browser_failure', id: 'submission', generation: 1, stage: 'candidate_upload' });
    expect(server.get('submission')?.pause_reason).toBeNull();
    expect(manager.getSnapshot().items[0].generation).toBe(2);
    expect(manager.getSnapshot().items[0].local_status).not.toBe('failed');
    vi.restoreAllMocks();
  });
  it.each(['Storage capacity is paused', 'Uploads are paused', 'Queue is full'])('keeps all selected files during %s and resumes without consuming technical attempts', async message => {
    vi.useFakeTimers();
    const { manager, dependencies, server, requests } = harness();
    const original = dependencies.api.request;
    let paused = true;
    dependencies.api.request = vi.fn(async (body) => {
      if (body.action === 'admit' && paused) throw new UploadApiError(message, 503);
      return original(body);
    });
    manager.start(); await flush();
    await manager.enqueue('trip', [new File(['abc'], 'first.jpg'), new File(['abc'], 'second.jpg')]);
    expect(manager.getSnapshot().items).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(14000); await flush();
    expect(server.size).toBe(0);
    expect(manager.getSnapshot().items.every((item) => item.local_status !== 'failed')).toBe(true);
    expect(requests.some((body) => body.action === 'browser_failure')).toBe(false);
    paused = false; await vi.advanceTimersByTimeAsync(4000); await flush();
    expect(server.size).toBe(2);
    expect([...server.values()].every((item) => item.phase === 'original_check')).toBe(true);
  });
  it('continues after a permanent admission error without retrying that file four times', async () => {
    const { manager, dependencies, server } = harness();
    const original = dependencies.api.request;
    dependencies.api.request = vi.fn(async (body) => {
      if (body.action === 'admit' && body.filename === 'denied.jpg') throw new UploadApiError('Trip access denied', 403);
      return original(body);
    });
    manager.start(); await flush();
    await manager.enqueue('trip', [new File(['abc'], 'denied.jpg'), new File(['abc'], 'accepted.jpg')]);
    expect(server.size).toBe(1);
    expect(manager.getSnapshot().items.find((item) => item.filename === 'denied.jpg')?.outcome).toBe('access_revoked');
  });
  it('reports submission generation one for a failed original whose transfer target uses generation zero', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const { manager, dependencies, requests } = harness([submission({ generation: 1 })]);
    const original = dependencies.api.request;
    dependencies.api.request = vi.fn(async (body) => {
      if (body.action === 'original_uploaded') throw new UploadApiError('Original acknowledgment temporarily unavailable', 503);
      return original(body);
    });
    vi.mocked(dependencies.api.transfer).mockRejectedValue(new UploadApiError('Transfer temporarily unavailable', 503));
    manager.start(); await flush(); await manager.reselect('submission', new File(['abc'], 'photo.jpg'));
    await vi.advanceTimersByTimeAsync(33000); await flush();
    expect(requests).toContainEqual({ action: 'browser_failure', id: 'submission', generation: 1, stage: 'original_upload' });
    expect(vi.mocked(dependencies.api.transfer).mock.calls[0][0].generation).toBe(0);
    vi.restoreAllMocks();
  });
  it('preserves an unadmitted identity through StrictMode restart and final stop', async () => {
    vi.useFakeTimers();
    const { manager, store, requests } = harness();
    await store.put({ submission: submission({ id: 'pending-before-mount' }), admissionRequest: 'stable-admission',
      candidateRequest: null, originalAcknowledged: false });
    manager.start(); manager.stop(); manager.start(); await flush();
    await vi.advanceTimersByTimeAsync(0); await flush();
    expect(store.values.has('pending-before-mount')).toBe(true);
    expect(manager.getSnapshot().items.find((item) => item.id === 'pending-before-mount')).toBeDefined();
    await manager.reselect('pending-before-mount', new File(['abc'], 'reselected.jpg'));
    await vi.advanceTimersByTimeAsync(2000); await flush();
    expect(requests).toContainEqual({ action: 'admit', id: 'pending-before-mount', request_id: 'stable-admission',
      trip_id: 'trip', filename: 'reselected.jpg', source_sha256: 'sha', source_bytes: 3 });
    manager.stop(); expect(manager.getSnapshot().items).toEqual([]);
    await vi.advanceTimersByTimeAsync(0); await flush(); expect(store.values.has('pending-before-mount')).toBe(true);
  });
  it('allows a manual retry cycle for an admission the server never received', async () => {
    vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0);
    const { manager, dependencies, server } = harness(); const original = dependencies.api.request;
    let unavailable = true;
    dependencies.api.request = vi.fn(async (body) => {
      if (body.action === 'admit' && unavailable) throw new UploadApiError('Temporary service problem', 503);
      return original(body);
    });
    manager.start(); await flush(); await manager.enqueue('trip', [new File(['abc'], 'photo.jpg')]);
    await vi.advanceTimersByTimeAsync(33000); await flush();
    const item = manager.getSnapshot().items[0]; expect(item.local_status).toBe('failed'); expect(server.size).toBe(0);
    unavailable = false; await manager.retry(item.id); await vi.advanceTimersByTimeAsync(2000); await flush();
    expect(server.get(item.id)?.phase).toBe('original_check'); vi.restoreAllMocks();
  });
  it.each(['Unknown submission', 'Submission access denied'])('resumes a never-admitted failed upload after reload when retry returns %s', async (message) => {
    vi.useFakeTimers();
    const { manager, store, dependencies, server, requests } = harness();
    const pending = submission({ id: 'failed-before-reload' });
    await store.put({ submission: pending, admissionRequest: 'stable-admission', candidateRequest: null,
      originalAcknowledged: false, localFailed: true, localError: 'Admission unavailable',
      localFailureGeneration: 0, localFailureStage: 'original_upload' });
    const original = dependencies.api.request;
    dependencies.api.request = vi.fn(async (body) => {
      if (body.action === 'retry' && !server.has(body.id)) throw new UploadApiError(message, 403);
      return original(body);
    });
    manager.start(); await flush();
    expect(manager.getSnapshot().items[0].local_status).toBe('failed');
    await manager.retry(pending.id);
    expect(manager.getSnapshot().items[0].local_status).toBe('needs_file');
    expect(store.values.get(pending.id)?.localFailed).toBe(false);
    await expect(manager.reselect(pending.id, new File(['wrong'], 'photo.jpg'))).rejects.toThrow('same original');
    await manager.reselect(pending.id, new File(['abc'], 'reselected.jpg'));
    await vi.advanceTimersByTimeAsync(2000); await flush();
    expect(requests).toContainEqual({ action: 'admit', id: pending.id, request_id: 'stable-admission',
      trip_id: 'trip', filename: 'reselected.jpg', source_sha256: 'sha', source_bytes: 3 });
    expect(server.get(pending.id)?.phase).toBe('original_check');
  });
  it('cancels an unadmitted identity through the server tombstone and never starts its original work', async () => {
    vi.useFakeTimers();
    const { manager, dependencies, server } = harness();
    const original = dependencies.api.request;
    dependencies.precheck = vi.fn(async () => null);
    dependencies.api.request = vi.fn(async (body) => {
      if (body.action === 'admit') throw new UploadApiError('Temporary service problem', 503);
      if (body.action === 'cancel' && !server.has(body.id)) {
        const tombstone = submission({ id: body.id, phase: 'complete', outcome: 'canceled', filename: null,
          source_sha256: null, source_bytes: null, cleanup_pending: true });
        server.set(body.id, tombstone);
        return { submission: tombstone };
      }
      return original(body);
    });
    manager.start(); await flush();
    await manager.enqueue('trip', [new File(['abc'], 'pending.jpg')]);
    const pending = manager.getSnapshot().items[0];
    expect(pending.outcome).toBeNull(); expect(server.size).toBe(0);
    await manager.cancel(pending.id);
    expect(dependencies.api.request).toHaveBeenCalledWith({ action: 'cancel', id: pending.id });
    expect(server.get(pending.id)?.outcome).toBe('canceled');
    expect(manager.getSnapshot().items[0]).toMatchObject({ id: pending.id, outcome: 'canceled', cleanup_pending: true });
    await vi.advanceTimersByTimeAsync(10000); await flush();
    expect(vi.mocked(dependencies.api.request).mock.calls.filter(([body]) => body.action === 'admit')).toHaveLength(1);
    expect(dependencies.precheck).not.toHaveBeenCalled();
    expect(dependencies.process).not.toHaveBeenCalled();
    expect(dependencies.api.transfer).not.toHaveBeenCalled();
  });
});

it('never republishes a result dismissed in another tab during a stale refresh', async () => {
  vi.useFakeTimers();
  const { manager, dependencies, store } = harness([
    submission({ id: 'rejected', phase: 'complete', outcome: 'rejected' }),
  ]);
  manager.start(); await flush();
  const snapshots: string[][] = [];
  manager.subscribe(() => snapshots.push(manager.getSnapshot().items.map(item => item.id)));
  // The refresh already read metadata when another tab commits Clear.
  const originalRequest = dependencies.api.request;
  vi.spyOn(dependencies.api, 'request').mockImplementation(async body => {
    if (body.action === 'list') {
      const value = store.values.get('rejected')!;
      store.values.set('rejected', { ...value, dismissed: true });
    }
    return originalRequest(body);
  });
  // Model the production store's atomic, permanent dismissal merge and return value.
  vi.spyOn(store, 'put').mockImplementation(async value => {
    const persisted = { ...value, dismissed: value.dismissed || store.values.get(value.submission.id)?.dismissed };
    store.values.set(value.submission.id, structuredClone(persisted));
    return persisted;
  });
  await vi.advanceTimersByTimeAsync(2500); await flush();
  expect(snapshots.length).toBeGreaterThan(0);
  expect(snapshots.every(ids => !ids.includes('rejected'))).toBe(true);
  expect(manager.getSnapshot().items).toEqual([]);
  expect(store.values.get('rejected')?.dismissed).toBe(true);
});
