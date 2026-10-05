import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T00:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('searches only submitted text, validates coordinates, and reuses cached results', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json([
    { lat: '0', lon: '0', display_name: 'Zero island' },
    { lat: '91', lon: '20', display_name: 'Invalid' },
    { lat: '1', display_name: 'Incomplete' },
    { lat: null, lon: '', display_name: 'Missing coordinates' },
  ]));
  vi.stubGlobal('fetch', fetcher);
  const { searchPlaces } = await import('./placeSearch');
  const signal = new AbortController().signal;
  const results = await searchPlaces('Zero island', signal);
  expect(results).toEqual([{ id: '0,0', name: 'Zero island', latitude: 0, longitude: 0 }]);
  expect(fetcher.mock.calls[0][0].searchParams.get('q')).toBe('Zero island');
  expect(fetcher.mock.calls[0][1]).toMatchObject({ signal, credentials: 'omit' });
  expect(await searchPlaces('zero island', signal)).toEqual(results);
  expect(fetcher).toHaveBeenCalledOnce();
  await expect(searchPlaces('Another place', signal)).rejects.toThrow('wait a moment');
});

it('reports failed searches and accepts a subsequent retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json([])));
  const { searchPlaces } = await import('./placeSearch');
  const signal = new AbortController().signal;
  await expect(searchPlaces('A', signal)).rejects.toThrow('place name');
  await expect(searchPlaces('Paris', signal)).rejects.toThrow('unavailable');
  vi.advanceTimersByTime(1100);
  expect(await searchPlaces('Paris', signal)).toEqual([]);
});
