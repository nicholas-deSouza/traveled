import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { loadAtlas } from '../lib/groups';
import { parisPhoto, parisTrip } from '../test/fixtures';
import { TravelGlobe } from '../components/maps/TravelGlobe';
import { DashboardPage } from './DashboardPage';

vi.mock('../components/maps/TravelGlobe', () => ({ TravelGlobe: vi.fn(() => <div aria-label="Globe" />) }));
vi.mock('../lib/useSession', () => ({ useSession: () => ({ user: { id: 'member' } }) }));
vi.mock('../lib/groups', () => ({ loadAtlas: vi.fn(), errorMessage: (error: Error) => error.message }));

it('loads the member atlas, passes it to the globe, and links to trip details', async () => {
  const atlas = { trips: [parisTrip], photos: [parisPhoto] };
  vi.mocked(loadAtlas).mockResolvedValue(atlas);
  render(<MemoryRouter><DashboardPage /></MemoryRouter>);
  expect(screen.getByRole('status')).toHaveTextContent('Loading your atlas');
  expect(await screen.findByRole('link', { name: 'Paris' })).toHaveAttribute('href', '/trips/paris');
  expect(loadAtlas).toHaveBeenCalledWith('member');
  expect(vi.mocked(TravelGlobe).mock.calls.at(-1)?.[0]).toEqual(atlas);
  expect(screen.getByText('1 trips · 1 moments')).toBeInTheDocument();
  expect(screen.queryByText(/No photos with GPS/)).not.toBeInTheDocument();
});

it('explains how to start an empty atlas', async () => {
  vi.mocked(loadAtlas).mockResolvedValue({ trips: [], photos: [] });
  render(<MemoryRouter><DashboardPage /></MemoryRouter>);
  expect(await screen.findByText('Join or create a group to start your shared atlas.')).toBeInTheDocument();
  expect(screen.getByText(/No photos with GPS locations yet/)).toBeInTheDocument();
});

it('retries a failed atlas load', async () => {
  vi.mocked(loadAtlas).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ trips: [], photos: [] });
  render(<MemoryRouter><DashboardPage /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  await userEvent.click(screen.getByRole('button', { name: 'Retry atlas' }));
  expect(await screen.findByText('Join or create a group to start your shared atlas.')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
