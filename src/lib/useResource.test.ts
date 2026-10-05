import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useResource } from './useResource';

it('keeps loaded content during refresh and a refresh failure', async () => {
  let fail!: (error: Error) => void;
  const loader = vi.fn().mockResolvedValueOnce('Visible group').mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const { result } = renderHook(() => useResource('group', loader, undefined, { keepPreviousData: true }));
  await waitFor(() => expect(result.current.data).toBe('Visible group'));
  act(() => result.current.reload());
  expect(result.current.data).toBe('Visible group');
  expect(result.current.loading).toBe(false);
  expect(result.current.refreshing).toBe(true);
  await act(async () => fail(new Error('Network unavailable')));
  expect(result.current.data).toBe('Visible group');
  expect(result.current.error).toBe('Network unavailable');
  expect(result.current.refreshing).toBe(false);
});

it('never retains another resource’s content after the key changes', async () => {
  const loader = vi.fn().mockResolvedValueOnce('First group').mockImplementationOnce(() => new Promise(() => {}));
  const { result, rerender } = renderHook(({ key }) => useResource(key, loader, undefined, { keepPreviousData: true }), { initialProps: { key: 'first' } });
  await waitFor(() => expect(result.current.data).toBe('First group'));
  rerender({ key: 'second' });
  expect(result.current.data).toBeUndefined();
  expect(result.current.loading).toBe(true);
});
