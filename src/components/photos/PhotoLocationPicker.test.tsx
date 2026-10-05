import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { PhotoLocationPicker } from './PhotoLocationPicker';
import { updatePhotoLocations } from '../../lib/groups';
import { searchPlaces } from '../../lib/placeSearch';
import { parisPhoto } from '../../test/fixtures';

vi.mock('../../lib/groups', () => ({ updatePhotoLocations: vi.fn(), errorMessage: (error: Error) => error.message }));
vi.mock('../../lib/placeSearch', () => ({ searchPlaces: vi.fn() }));
vi.mock('../maps/PhotoLocationMap', () => ({ PhotoLocationMap: () => <div>Location map</div> }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
const photos = [{ ...parisPhoto, latitude: null, longitude: null }, { ...parisPhoto, id: 'two', latitude: null, longitude: null }];
const props = () => ({ tripId: 'paris', photos, onClose: vi.fn(), onSaved: vi.fn() });

it('saves one searched location to the selected photos only', async () => {
  const callbacks = props();
  vi.mocked(searchPlaces).mockResolvedValue([{ id: 'place', name: 'Paris, France', latitude: 48.85, longitude: 2.35 }]);
  vi.mocked(updatePhotoLocations).mockResolvedValue();
  render(<PhotoLocationPicker {...callbacks} />);
  expect(screen.getByRole('button', { name: 'Save location' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Search for a place' })).toHaveFocus();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Photo 2' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Search for a place' }), 'Paris');
  await userEvent.click(screen.getByRole('button', { name: 'Search places' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Paris, France' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save location' }));
  expect(updatePhotoLocations).toHaveBeenCalledWith('paris', ['one'], { latitude: 48.85, longitude: 2.35 });
  expect(callbacks.onSaved).toHaveBeenCalledWith(['one'], { latitude: 48.85, longitude: 2.35 });
});

it('preserves the selection after a failed save, disables duplicate saves, and retries without uploading again', async () => {
  const callbacks = props();
  let reject!: (reason: Error) => void;
  vi.mocked(updatePhotoLocations).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; })).mockResolvedValue();
  render(<PhotoLocationPicker {...callbacks} />);
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Latitude' }), '0');
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Longitude' }), '0');
  await userEvent.click(screen.getByRole('button', { name: 'Save location' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Later' })).toBeDisabled();
  await act(async () => reject(new Error('Offline')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your photos are still uploaded. Offline');
  expect(screen.getByRole('checkbox', { name: 'Photo 2' })).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: 'Save location' }));
  expect(callbacks.onSaved).toHaveBeenCalledWith(['one', 'two'], { latitude: 0, longitude: 0 });
});

it('allows dismissal without searching or saving, and requires both a selection and valid coordinates', async () => {
  const callbacks = props();
  render(<PhotoLocationPicker {...callbacks} />);
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Latitude' }), '91');
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Longitude' }), '0');
  expect(screen.getByRole('button', { name: 'Save location' })).toBeDisabled();
  await userEvent.clear(screen.getByRole('spinbutton', { name: 'Latitude' }));
  await userEvent.type(screen.getByRole('spinbutton', { name: 'Latitude' }), '0');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Photo 1' }));
  await userEvent.click(screen.getByRole('checkbox', { name: 'Photo 2' }));
  expect(screen.getByRole('button', { name: 'Save location' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Later' }));
  expect(callbacks.onClose).toHaveBeenCalledOnce();
  expect(updatePhotoLocations).not.toHaveBeenCalled();
});

it('shows search progress, no results, and a retryable search error while coordinate entry remains available', async () => {
  let resolve!: (places: []) => void;
  vi.mocked(searchPlaces).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockRejectedValueOnce(new Error('Search offline'));
  render(<PhotoLocationPicker {...props()} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Search for a place' }), 'Somewhere');
  await userEvent.click(screen.getByRole('button', { name: 'Search places' }));
  expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled();
  await act(async () => resolve([]));
  expect(screen.getByText(/No places found/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Search places' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Search offline');
  expect(screen.getByRole('spinbutton', { name: 'Latitude' })).toBeEnabled();
});
