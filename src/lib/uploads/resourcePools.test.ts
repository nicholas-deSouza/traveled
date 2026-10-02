import { afterEach, describe, expect, it, vi } from 'vitest';
import { deviceLimits, ResourcePools, StoppedUpload } from './resourcePools';
import { fakeLocks } from './testHelpers';
afterEach(() => vi.useRealTimers());
describe('account resource reservations', () => {
  it('holds candidate buffers across different tabs until their uploading/retry owner releases', async () => {
    vi.useFakeTimers();
    const locks = fakeLocks(), signal = new AbortController();
    const first = new ResourcePools(locks, 'user', deviceLimits(true));
    const second = new ResourcePools(locks, 'user', deviceLimits(true));
    const releases = [await first.acquire('buffer', signal.signal), await second.acquire('buffer', signal.signal)];
    let acquired = false;
    const third = second.acquire('buffer', signal.signal).then((release) => { acquired = true; return release; });
    await vi.advanceTimersByTimeAsync(500);
    expect(acquired).toBe(false);
    releases[0](); await vi.advanceTimersByTimeAsync(100);
    expect(acquired).toBe(true);
    (await third)(); releases[1]();
  });
  it('releases slots when processing fails and when waiting work stops', async () => {
    vi.useFakeTimers();
    const pools = new ResourcePools(fakeLocks(), 'user', deviceLimits(true));
    const controller = new AbortController();
    await expect(pools.run('processing', controller.signal, async () => { throw new Error('decode failed'); })).rejects.toThrow('decode failed');
    const release = await pools.acquire('processing', controller.signal);
    const blocked = pools.acquire('processing', controller.signal);
    const rejected = expect(blocked).rejects.toBeInstanceOf(StoppedUpload);
    controller.abort(); await rejected; release();
  });
  it('uses independent account pools and ADR phone/desktop limits', async () => {
    expect(deviceLimits(false)).toEqual({ processing: 2, upload: 3, buffer: 3 });
    expect(deviceLimits(true)).toEqual({ processing: 1, upload: 2, buffer: 2 });
    const locks = fakeLocks(), controller = new AbortController();
    const a = await new ResourcePools(locks, 'a', deviceLimits(true)).acquire('processing', controller.signal);
    const b = await new ResourcePools(locks, 'b', deviceLimits(true)).acquire('processing', controller.signal);
    a(); b();
  });
});
