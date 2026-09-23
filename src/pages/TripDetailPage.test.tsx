import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { loadTrip, uploadPhoto } from '../lib/groups';
import { TripDetailPage } from './TripDetailPage';

vi.mock('../lib/groups', () => ({ loadTrip: vi.fn(), uploadPhoto: vi.fn(), errorMessage: (error: Error) => error.message }));
vi.mock('../lib/useSession', () => ({ useSession: () => ({ user: { id: 'member' } }) }));
vi.mock('../components/photos/TripPhotos', () => ({ TripPhotos: () => <p>Trip gallery</p> }));
function mount() {
  return render(<MemoryRouter initialEntries={['/trips/paris']}><Routes><Route path="/trips/:tripId" element={<TripDetailPage />} /></Routes></MemoryRouter>);
}
it('uploads a selected photo and reports success', async () => {
  const trip = { id: 'paris', group_id: 'friends', created_by: 'member', color: null, title: 'Paris', description: null, starts_on: null, ends_on: null };
  vi.mocked(loadTrip).mockResolvedValue({ trip, group: { id: 'friends', name: 'Friends', created_by: 'owner' } });
  vi.mocked(uploadPhoto).mockResolvedValue(undefined);
  mount();
  expect(await screen.findByRole('heading', { name: 'Paris' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload photos' })).toBeDisabled();
  const file = new File(['photo'], 'paris.jpg', { type: 'image/jpeg' });
  await userEvent.upload(screen.getByLabelText(/Add photos/), file);
  await userEvent.click(screen.getByRole('button', { name: 'Upload 1 photos' }));
  expect(await screen.findByRole('status')).toHaveTextContent('1 photo added.');
  expect(uploadPhoto).toHaveBeenCalledWith(trip, 'member', file);
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
