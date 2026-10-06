import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { PhotoUploadQueue } from './PhotoUploadQueue';
import type { UploadSubmission } from '../../lib/photoUploadContract';

type Item = UploadSubmission & { local_status: 'failed' | 'needs_file' | null; local_error: string | null };
const mock = vi.hoisted(() => ({ snapshot: { items: [] as Item[], error: null as string | null, compatible: true }, retry: vi.fn(), cancel: vi.fn(), reselect: vi.fn(), clearFinished: vi.fn() }));
vi.mock('../../lib/useUploadManager', () => ({ useUploadManager: () => ({
  subscribe: () => () => {}, getSnapshot: () => mock.snapshot, retry: mock.retry, cancel: mock.cancel, reselect: mock.reselect, clearFinished: mock.clearFinished,
}) }));
function item(values: Partial<Item> = {}): Item {
  return { id: 'one', trip_id: 'trip', user_id: 'user', filename: 'Paris.jpg', phase: 'original_check', outcome: null,
    generation: 0, created_at: '', expires_at: '', gps_acknowledged: false, latitude: null, longitude: null,
    source_sha256: null, source_bytes: 1, retry_at: null, attempts: 0, error: null, pause_reason: null,
    cleanup_pending: false, local_status: null, local_error: null, ...values };
}
function mount() { return render(<MemoryRouter><PhotoUploadQueue /></MemoryRouter>); }
beforeEach(() => { mock.snapshot = { items: [], error: null, compatible: true }; mock.retry.mockResolvedValue(undefined); mock.cancel.mockResolvedValue(undefined); mock.clearFinished.mockReset().mockResolvedValue(undefined); });
it('shows Clear only for visible finished results and dismisses them without canceling uploads', async () => {
  mock.snapshot.items = [item(), item({ id: 'old', outcome: 'invalid', phase: 'complete' })];
  const view = mount();
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(mock.clearFinished).toHaveBeenCalledOnce();
  expect(mock.cancel).not.toHaveBeenCalled();
  mock.snapshot = { ...mock.snapshot, items: [item()] };
  view.rerender(<MemoryRouter><PhotoUploadQueue /></MemoryRouter>);
  expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  expect(screen.getByText('Awaiting original verification')).toBeInTheDocument();
});
it('reports a Clear failure without hiding the result', async () => {
  mock.snapshot.items = [item({ outcome: 'rejected', phase: 'complete' })];
  mock.clearFinished.mockRejectedValue(new Error('Unable to save dismissal'));
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save dismissal');
  expect(screen.getByText('Not added: did not pass verification')).toBeInTheDocument();
});
it('shows verification progress and cancels only remaining submissions', async () => {
  mock.snapshot.items = [item(), item({ id: 'published', filename: 'Added.jpg', outcome: 'published' })];
  mount();
  expect(screen.getByText('Awaiting original verification')).toBeInTheDocument();
  expect(screen.queryByText('Added to gallery')).not.toBeInTheDocument();
  expect(screen.queryByText('Added.jpg')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel remaining' }));
  expect(mock.cancel).toHaveBeenCalledExactlyOnceWith('one');
  expect(screen.getByRole('button', { name: 'Retry failed' })).toBeDisabled();
});
it('offers file reselection and retries technical errors through the stable identity', async () => {
  mock.snapshot.items = [item({ local_status: 'failed' }), item({ id: 'two', filename: 'Rome.jpg', local_status: 'needs_file' })];
  mock.retry.mockRejectedValue(new Error('Offline'));
  mock.reselect.mockResolvedValue(undefined);
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Retry Paris.jpg' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  const file = new File(['image'], 'Rome.jpg', { type: 'image/jpeg' });
  await userEvent.upload(screen.getByLabelText('Reselect Rome.jpg'), file);
  await waitFor(() => expect(mock.reselect).toHaveBeenCalledWith('two', file));
});
it('explains browser incompatibility and quota pauses', () => {
  mock.snapshot.compatible = false;
  mock.snapshot.items = [item({ pause_reason: 'quota' })];
  mount();
  expect(screen.getByRole('alert')).toHaveTextContent('Update your browser');
  expect(screen.getByText(/verification allowance resets/)).toBeInTheDocument();
});
it.each([
  ['Uploads are paused', 'Paused by the upload service'],
  ['Storage capacity is paused', 'Paused: Storage capacity unavailable'],
])('distinguishes %s from other pause causes', (error, message) => {
  mock.snapshot.items = [item({ pause_reason: 'capacity', local_error: error })];
  mount();
  expect(screen.getByText(message)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry failed' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel remaining' })).toBeEnabled();
});
it('hides canceled uploads and the empty queue', () => {
  mock.snapshot.items = [item({ trip_id: '00000000-0000-0000-0000-000000000000', outcome: 'canceled', phase: 'complete' })];
  mount();
  expect(screen.queryByText('Canceled')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Photo uploads' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open trip' })).not.toBeInTheDocument();
});
it('removes the status as soon as the last upload is published', () => {
  mock.snapshot.items = [item()];
  const view = mount();
  expect(screen.getByRole('heading', { name: 'Photo uploads' })).toBeInTheDocument();
  mock.snapshot = { ...mock.snapshot, items: [item({ outcome: 'published', phase: 'complete' })] };
  view.rerender(<MemoryRouter><PhotoUploadQueue /></MemoryRouter>);
  expect(screen.queryByRole('heading', { name: 'Photo uploads' })).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('keeps unsuccessful outcomes visible after other uploads finish', () => {
  mock.snapshot.items = [item({ outcome: 'published' }), item({ id: 'rejected', filename: 'Rejected.jpg', outcome: 'rejected' })];
  mount();
  expect(screen.getByText('Not added: did not pass verification')).toBeInTheDocument();
  expect(screen.queryByText('Added to gallery')).not.toBeInTheDocument();
});
it('keeps queue errors visible when there are no remaining uploads', () => {
  mock.snapshot.items = [item({ outcome: 'published' })];
  mock.snapshot.error = 'Unable to refresh uploads';
  mount();
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to refresh uploads');
});
it.each(['published', 'canceled', 'deleted'] as const)('clears stale action errors when the last upload is %s', async outcome => {
  mock.snapshot.items = [item({ local_status: 'failed' })];
  mock.retry.mockRejectedValue(new Error('Offline'));
  const view = mount();
  await userEvent.click(screen.getByRole('button', { name: 'Retry Paris.jpg' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');

  mock.snapshot = { ...mock.snapshot, items: [item({ outcome, phase: 'complete' })] };
  view.rerender(<MemoryRouter><PhotoUploadQueue /></MemoryRouter>);
  expect(screen.queryByRole('heading', { name: 'Photo uploads' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  mock.snapshot = { ...mock.snapshot, items: [item({ id: 'new' })] };
  view.rerender(<MemoryRouter><PhotoUploadQueue /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Photo uploads' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
