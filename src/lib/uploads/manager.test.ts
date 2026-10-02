import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUploadManager, type ManagerDependencies } from './manager';
import { fakeChannel, fakeLocks, memoryStore, submission } from './testHelpers';
import type { UploadRequest, UploadResponse, UploadSubmission } from '../photoUploadContract';
import { UploadApiError } from './photoUploadApi';
vi.mock('./photoUploadApi', async (importOriginal) => ({ ...await importOriginal<typeof import('./photoUploadApi')>(), photoUploadApi: {} }));
vi.mock('./processor', () => ({ processPhoto: vi.fn(), precheckPhoto: vi.fn(async () => null) }));
vi.mock('../photoMetadata', () => ({ extractLocation: vi.fn() }));
const managers: ReturnType<typeof createUploadManager>[] = [];
afterEach(() => { for (const manager of managers) manager.stop(); managers.length = 0; vi.useRealTimers(); });
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
    fingerprint: vi.fn(async () => 'sha'), gps: vi.fn(async () => ({ latitude: null, longitude: null })),
    online: () => true, compatible: true, phone: false };
  const manager = createUploadManager('user', dependencies); managers.push(manager);
  return { manager, server, requests, dependencies, store };
}
async function flush() { for (let index = 0; index < 40; index++) await Promise.resolve(); }
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
  it('keeps all selected files during capacity pauses and resumes without consuming technical attempts', async () => {
    vi.useFakeTimers();
    const { manager, dependencies, server, requests } = harness();
    const original = dependencies.api.request;
    let paused = true;
    dependencies.api.request = vi.fn(async (body) => {
      if (body.action === 'admit' && paused) throw new UploadApiError('Storage capacity is paused', 503);
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
  it('preserves an unadmitted identity through StrictMode restart and clears it after a final stop', async () => {
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
    await vi.advanceTimersByTimeAsync(0); await flush(); expect(store.values.size).toBe(0);
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
