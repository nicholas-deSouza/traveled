import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { PhotoUploadQueue } from './PhotoUploadQueue';
import type { UploadSubmission } from '../../lib/photoUploadContract';

type Item = UploadSubmission & { local_status: 'failed' | 'needs_file' | null; local_error: string | null };
const mock = vi.hoisted(() => ({ snapshot: { items: [] as Item[], error: null as string | null, compatible: true }, retry: vi.fn(), cancel: vi.fn(), reselect: vi.fn() }));
vi.mock('../../lib/useUploadManager', () => ({ useUploadManager: () => ({
  subscribe: () => () => {}, getSnapshot: () => mock.snapshot, retry: mock.retry, cancel: mock.cancel, reselect: mock.reselect,
}) }));
function item(values: Partial<Item> = {}): Item {
  return { id: 'one', trip_id: 'trip', user_id: 'user', filename: 'Paris.jpg', phase: 'original_check', outcome: null,
    generation: 0, created_at: '', expires_at: '', gps_acknowledged: false, latitude: null, longitude: null,
    source_sha256: null, source_bytes: 1, retry_at: null, attempts: 0, error: null, pause_reason: null,
    cleanup_pending: false, local_status: null, local_error: null, ...values };
}
function mount() { return render(<MemoryRouter><PhotoUploadQueue /></MemoryRouter>); }
beforeEach(() => { mock.snapshot = { items: [], error: null, compatible: true }; mock.retry.mockResolvedValue(undefined); mock.cancel.mockResolvedValue(undefined); });
it('shows verification progress and cancels only remaining submissions', async () => {
  mock.snapshot.items = [item(), item({ id: 'published', filename: 'Added.jpg', outcome: 'published' })];
  mount();
  expect(screen.getByText('Awaiting original verification')).toBeInTheDocument();
  expect(screen.getByText('Added to gallery')).toBeInTheDocument();
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
  expect(screen.getByRole('alert')).toHaveTextContent('Web Locks');
  expect(screen.getByText(/verification allowance resets/)).toBeInTheDocument();
});
it('shows a canceled pre-admission identity without a nonexistent trip link', () => {
  mock.snapshot.items = [item({ trip_id: '00000000-0000-0000-0000-000000000000', outcome: 'canceled', phase: 'complete' })];
  mount();
  expect(screen.getByText('Canceled')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open trip' })).not.toBeInTheDocument();
});
