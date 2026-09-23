import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { loadGroup, createTrip } from '../lib/groups';
import { GroupDetailPage } from './GroupDetailPage';

vi.mock('../lib/groups', () => ({ loadGroup: vi.fn(), createTrip: vi.fn(), createInvitation: vi.fn(), revokeInvitation: vi.fn(), errorMessage: (error: Error) => error.message }));
vi.mock('../lib/useSession', () => ({ useSession: () => ({ user: { id: 'member' } }) }));
function mount() {
  return render(<MemoryRouter initialEntries={['/groups/friends']}><Routes><Route path="/groups/:groupId" element={<GroupDetailPage />} /><Route path="/trips/new-trip" element={<p>New trip details</p>} /></Routes></MemoryRouter>);
}
it('lets members create trips but hides owner invitation controls', async () => {
  vi.mocked(loadGroup).mockResolvedValue({ group: { id: 'friends', name: 'Friends', created_by: 'owner' }, trips: [], members: [] });
  vi.mocked(createTrip).mockResolvedValue('new-trip');
  mount();
  expect(await screen.findByRole('heading', { name: 'Friends' })).toBeInTheDocument();
  expect(loadGroup).toHaveBeenCalledWith('friends');
  expect(screen.queryByRole('button', { name: 'Create invite link' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Create a trip' }));
  expect(screen.getByRole('button', { name: 'Create trip' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Trip title'), 'Paris');
  await userEvent.click(screen.getByRole('button', { name: 'Create trip' }));
  expect(createTrip).toHaveBeenCalledWith('friends', 'member', expect.objectContaining({ title: 'Paris' }));
  expect(await screen.findByText('New trip details')).toBeInTheDocument();
});
it('retries failed loads and shows owner controls', async () => {
  vi.mocked(loadGroup).mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValue({ group: { id: 'friends', name: 'Friends', created_by: 'member' }, trips: [], members: [] });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: 'Create invite link' })).toBeInTheDocument();
});
