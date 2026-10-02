import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { loadTrip } from '../lib/groups';
import { TripDetailPage } from './TripDetailPage';

vi.mock('../lib/groups', () => ({ loadTrip: vi.fn(), errorMessage: (error: Error) => error.message }));
vi.mock('../lib/useSession', () => ({ useSession: () => ({ user: { id: 'member' } }) }));
vi.mock('../components/photos/TripPhotos', () => ({ TripPhotos: () => <p>Trip gallery</p> }));
const enqueue = vi.hoisted(() => vi.fn());
vi.mock('../lib/useUploadManager', () => ({ useUploadManager: () => ({ enqueue }) }));
function mount() {
  return render(<MemoryRouter initialEntries={['/trips/paris']}><Routes><Route path="/trips/:tripId" element={<TripDetailPage />} /></Routes></MemoryRouter>);
}
it('queues selected photos without prematurely reporting publication', async () => {
  const trip = { id: 'paris', group_id: 'friends', created_by: 'member', color: null, title: 'Paris', description: null, starts_on: null, ends_on: null };
  vi.mocked(loadTrip).mockResolvedValue({ trip, group: { id: 'friends', name: 'Friends', created_by: 'owner' } });
  enqueue.mockResolvedValue(undefined);
  mount();
  expect(await screen.findByRole('heading', { name: 'Paris' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload photos' })).toBeDisabled();
  const file = new File(['photo'], 'paris.jpg', { type: 'image/jpeg' });
  await userEvent.upload(screen.getByLabelText(/Add photos/), file);
  await userEvent.click(screen.getByRole('button', { name: 'Upload 1 photos' }));
  expect(await screen.findByRole('status')).toHaveTextContent('1 photo queued.');
  expect(enqueue).toHaveBeenCalledWith('paris', [file]);
  expect(screen.getByRole('button', { name: 'Upload photos' })).toBeDisabled();
});
it('shows errors and retries loading the trip', async () => {
  vi.mocked(loadTrip).mockRejectedValue(new Error('Trip unavailable'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Trip unavailable');
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Trip unavailable');
  expect(loadTrip).toHaveBeenCalledTimes(2);
});

it('shows admission errors and allows another selection', async () => {
  vi.mocked(loadTrip).mockResolvedValue({ trip: { id: 'paris', group_id: 'friends', created_by: 'member', color: null, title: 'Paris', description: null, starts_on: null, ends_on: null }, group: { id: 'friends', name: 'Friends', created_by: 'owner' } });
  enqueue.mockRejectedValue(new Error('Queue capacity unavailable'));
  mount();
  await screen.findByRole('heading', { name: 'Paris' });
  await userEvent.upload(screen.getByLabelText(/Add photos/), new File(['x'], 'p.jpg', { type: 'image/jpeg' }));
  await userEvent.click(screen.getByRole('button', { name: 'Upload 1 photos' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Queue capacity unavailable');
  expect(screen.getByLabelText(/Add photos/)).toBeEnabled();
});
