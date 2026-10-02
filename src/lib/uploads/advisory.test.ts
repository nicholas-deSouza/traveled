import { afterEach, describe, expect, it, vi } from 'vitest';
import { advisoryPrecheck } from './advisory';
afterEach(() => vi.useRealTimers());
describe('advisory precheck', () => {
  it('continues without a result when initialization fails', async () => {
    expect(await advisoryPrecheck({} as ImageData, async () => { throw new Error('model unavailable'); })).toBeNull();
  });
  it('continues after five seconds when initialization never completes', async () => {
    vi.useFakeTimers();
    const result = advisoryPrecheck({} as ImageData, () => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toBeNull();
  });
});
