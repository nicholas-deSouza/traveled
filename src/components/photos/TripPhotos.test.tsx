import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { loadTripPhotos, releasePhotos } from '../../lib/groups';
import { TripPhotos } from './TripPhotos';
import { parisPhoto } from '../../test/fixtures';

vi.mock('../../lib/useSession', () => ({ useSession: () => ({ user: { id: 'member' } }) }));

vi.mock('../../lib/groups', () => ({ loadTripPhotos: vi.fn(), releasePhotos: vi.fn(), PHOTO_PAGE_SIZE: 8, errorMessage: (error: Error) => error.message }));
it('shows an empty state', async () => {
  vi.mocked(loadTripPhotos).mockResolvedValue({ photos: [], hasMore: false });
  render(<TripPhotos tripId="trip" title="Paris" />);
  expect(await screen.findByText(/Your first memory belongs here/)).toBeInTheDocument();
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
});
it('allows retry after a failed load', async () => {
  vi.mocked(loadTripPhotos).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ photos: [], hasMore: false });
  render(<TripPhotos tripId="trip" title="Paris" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  await userEvent.click(screen.getByRole('button', { name: 'Retry photos' }));
  expect(await screen.findByText(/Your first memory belongs here/)).toBeInTheDocument();
});
it('paginates and releases the previous page', async () => {
  vi.mocked(loadTripPhotos).mockResolvedValueOnce({ photos: [parisPhoto], hasMore: true }).mockResolvedValue({ photos: [], hasMore: false });
  const { unmount } = render(<TripPhotos tripId="trip" title="Paris" />);
  expect(await screen.findByRole('button', { name: 'Previous photos' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Next photos' }));
  await waitFor(() => expect(loadTripPhotos).toHaveBeenLastCalledWith('trip', 1, [parisPhoto]));
  expect(await screen.findByText(/No photos on this page/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next photos' })).toBeDisabled();
  unmount();
  expect(releasePhotos).toHaveBeenCalledWith([parisPhoto]);
});
it('keeps available photos visible alongside unavailable placeholders', async () => {
  vi.mocked(loadTripPhotos).mockResolvedValue({ photos: [
    parisPhoto,
    { ...parisPhoto, id: 'two', storage_path: 'two.jpg', url: null },
  ], hasMore: false });
  render(<TripPhotos tripId="trip" title="Paris" />);
  expect(await screen.findByRole('button', { name: 'Open Photo 1 from Paris' })).toBeEnabled();
  expect(screen.getByRole('img', { name: 'Photo 1 from Paris' })).toHaveAttribute('src', 'blob:one');
  expect(screen.getByRole('img', { name: 'Photo 2 from Paris is unavailable' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry unavailable photos' }));
  await waitFor(() => expect(loadTripPhotos).toHaveBeenCalledTimes(2));
});
