import { render, screen, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PhotoUploadProvider } from './PhotoUploadProvider';
import { PHOTO_CHANGED_EVENT } from '../../lib/photoChanges';
import type { UploadSubmission } from '../../lib/photoUploadContract';
import { MemoryRouter, Link, Routes, Route } from 'react-router-dom';
import userEvent from '@testing-library/user-event';

const mock = vi.hoisted(() => ({ stop: vi.fn(), start: vi.fn(), listener: () => {}, items: [] as UploadSubmission[] }));
vi.mock('../../lib/uploads/manager', () => ({ createUploadManager: () => ({
  start: mock.start, stop: mock.stop, getSnapshot: () => ({ items: mock.items }),
  subscribe: (listener: () => void) => { mock.listener = listener; return vi.fn(); },
}) }));
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
