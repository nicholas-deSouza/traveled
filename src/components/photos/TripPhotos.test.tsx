import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { loadTripPhotos, releasePhotos, updatePhotoLocations } from '../../lib/groups';
import { TripPhotos } from './TripPhotos';
import { parisPhoto } from '../../test/fixtures';
import { notifyPhotoChanged } from '../../lib/photoChanges';

vi.mock('../../lib/useSession', () => ({ useSession: () => ({ user: { id: 'member' } }) }));

vi.mock('../../lib/groups', () => ({ loadTripPhotos: vi.fn(), releasePhotos: vi.fn(), updatePhotoLocations: vi.fn(), PHOTO_PAGE_SIZE: 8, errorMessage: (error: Error) => error.message }));
vi.mock('../maps/PhotoLocationMap', () => ({ PhotoLocationMap: () => <div>Location map</div> }));
vi.mock('../../lib/placeSearch', () => ({ searchPlaces: vi.fn() }));
beforeEach(() => {
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
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

it('offers optional bulk assignment only for the uploader’s unlocated photos, without opening a dialog automatically', async () => {
  vi.mocked(loadTripPhotos).mockResolvedValue({ photos: [
    { ...parisPhoto, latitude: null, longitude: null },
    { ...parisPhoto, id: 'peer', uploaded_by: 'other', latitude: null, longitude: null },
    { ...parisPhoto, id: 'gps' },
  ], hasMore: false });
  render(<TripPhotos tripId="paris" title="Paris" />);
  expect(await screen.findByText(/1 of your photos on this page/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Photo 2 from Paris' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Add location to Photo 2 from Paris' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add location to Photo 3 from Paris' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Add location' }));
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
});

it('remembers Later across remounts, retains individual actions, and prompts for newly uploaded photos', async () => {
  const first = { ...parisPhoto, latitude: null, longitude: null };
  vi.mocked(loadTripPhotos).mockResolvedValue({ photos: [first], hasMore: false });
  const { unmount } = render(<TripPhotos tripId="paris" title="Paris" />);
  await screen.findByText(/Where were these photos taken/);
  await userEvent.click(screen.getByRole('button', { name: 'Later' }));
  expect(screen.queryByText(/Where were these photos taken/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add location to Photo 1 from Paris' })).toBeEnabled();
  unmount();
  vi.mocked(loadTripPhotos).mockResolvedValue({ photos: [first, { ...first, id: 'new' }], hasMore: false });
  render(<TripPhotos tripId="paris" title="Paris" />);
  expect(await screen.findByText(/1 of your photos on this page/)).toBeInTheDocument();
});

it('updates the gallery locally after saving without removing photos or requiring another upload', async () => {
  vi.mocked(loadTripPhotos).mockResolvedValue({ photos: [{ ...parisPhoto, latitude: null, longitude: null }], hasMore: false });
  vi.mocked(updatePhotoLocations).mockResolvedValue();
  render(<TripPhotos tripId="paris" title="Paris" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Add location to Photo 1 from Paris' }));
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Latitude' }), '48.85');
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Longitude' }), '2.35');
  await userEvent.click(screen.getByRole('button', { name: 'Save location' }));
  expect(await screen.findByText('Location added to 1 photo.')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Photo 1 from Paris' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Add location to Photo 1 from Paris' })).not.toBeInTheDocument();
});

it('keeps location selection open as another photo finishes uploading in the background', async () => {
  const original = { ...parisPhoto, latitude: null, longitude: null };
  vi.mocked(loadTripPhotos).mockResolvedValueOnce({ photos: [original], hasMore: false });
  vi.mocked(updatePhotoLocations).mockResolvedValue();
  render(<TripPhotos tripId="paris" title="Paris" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Add location to Photo 1 from Paris' }));
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Latitude' }), '10');
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Longitude' }), '20');
  vi.mocked(loadTripPhotos).mockResolvedValue({ photos: [{ ...original, id: 'new-upload' }, original], hasMore: false });
  act(() => notifyPhotoChanged('paris'));
  await waitFor(() => expect(loadTripPhotos).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('dialog', { name: 'Add photo location' })).toBeInTheDocument();
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  expect(screen.getByRole('spinbutton', { name: 'Latitude' })).toHaveValue(10);
  await userEvent.click(screen.getByRole('button', { name: 'Save location' }));
  expect(updatePhotoLocations).toHaveBeenCalledWith('paris', ['one'], { latitude: 10, longitude: 20 });
  expect(await screen.findByRole('button', { name: 'Open Photo 1 from Paris' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Add location to Photo 1 from Paris' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Add location to Photo 2 from Paris' })).not.toBeInTheDocument();
});
