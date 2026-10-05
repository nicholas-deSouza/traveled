import { render, screen, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PhotoUploadProvider } from './PhotoUploadProvider';
import { PHOTO_CHANGED_EVENT } from '../../lib/photoChanges';
import type { UploadSubmission } from '../../lib/photoUploadContract';
import { MemoryRouter, Link, Routes, Route } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { createUploadManager } from '../../lib/uploads/manager';
import { useUploadManager } from '../../lib/useUploadManager';

const mock = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn(), listener: () => {}, items: [] as UploadSubmission[] }));
vi.mock('../../lib/uploads/manager', () => ({ createUploadManager: vi.fn(() => ({
  start: mock.start, stop: mock.stop, getSnapshot: () => ({ items: mock.items }),
  subscribe: (listener: () => void) => { mock.listener = listener; return vi.fn(); },
})) }));
vi.mock('./PhotoUploadQueue', () => ({ PhotoUploadQueue: () => <p>Upload controls</p> }));

it('keeps route content and controls mounted and stops account work on unmount', () => {
  const { unmount } = render(<PhotoUploadProvider userId="user"><p>Trip content</p></PhotoUploadProvider>);
  expect(screen.getByText('Trip content')).toBeInTheDocument();
  expect(screen.getByText('Upload controls')).toBeInTheDocument();
  unmount();
  expect(mock.stop).toHaveBeenCalledOnce();
});
it('refreshes galleries once when a submission becomes published', () => {
  mock.items = [];
  const change = vi.fn();
  window.addEventListener(PHOTO_CHANGED_EVENT, change);
  const { unmount } = render(<PhotoUploadProvider userId="user"><p>Trip</p></PhotoUploadProvider>);
  mock.items = [{ id: 'one', trip_id: 'trip', outcome: 'published' } as UploadSubmission];
  act(() => mock.listener());
  act(() => mock.listener());
  expect(change).toHaveBeenCalledOnce();
  unmount();
  window.removeEventListener(PHOTO_CHANGED_EVENT, change);
});
it('preserves account work while navigating between trips', async () => {
  render(<MemoryRouter><PhotoUploadProvider userId="user"><Link to="/trips/rome">Open Rome</Link><Routes>
    <Route path="/" element={<p>Paris trip</p>} /><Route path="/trips/rome" element={<p>Rome trip</p>} />
  </Routes></PhotoUploadProvider></MemoryRouter>);
  await userEvent.click(screen.getByRole('link', { name: 'Open Rome' }));
  expect(screen.getByText('Rome trip')).toBeInTheDocument();
  expect(mock.start).toHaveBeenCalledOnce();
  expect(mock.stop).not.toHaveBeenCalled();
});

it('replaces the context and stops the old manager when the signed-in account changes', () => {
  const first = { start: vi.fn(), stop: vi.fn(), getSnapshot: () => ({ items: [] }), subscribe: vi.fn(() => vi.fn()) };
  const second = { ...first, start: vi.fn(), stop: vi.fn() };
  vi.mocked(createUploadManager)
    .mockReturnValueOnce(first as unknown as ReturnType<typeof createUploadManager>)
    .mockReturnValueOnce(second as unknown as ReturnType<typeof createUploadManager>);
  const seen: unknown[] = [];
  function Consumer() { seen.push(useUploadManager()); return <p>Trip</p>; }
  const { rerender, unmount } = render(<PhotoUploadProvider userId="first"><Consumer /></PhotoUploadProvider>);
  expect(seen.at(-1)).toBe(first);
  rerender(<PhotoUploadProvider userId="second"><Consumer /></PhotoUploadProvider>);
  expect(seen.at(-1)).toBe(second);
  expect(first.stop).toHaveBeenCalledOnce();
  expect(second.start).toHaveBeenCalledOnce();
  expect(second.stop).not.toHaveBeenCalled();
  expect(createUploadManager).toHaveBeenNthCalledWith(1, 'first');
  expect(createUploadManager).toHaveBeenNthCalledWith(2, 'second');
  unmount();
  expect(second.stop).toHaveBeenCalledOnce();
});
