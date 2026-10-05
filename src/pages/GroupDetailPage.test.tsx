import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { loadGroup, createTrip, GroupAccessError } from '../lib/groups';
import { GroupDetailPage } from './GroupDetailPage';

vi.mock('../lib/groups', () => ({ GroupAccessError: class extends Error {}, loadGroup: vi.fn(), createTrip: vi.fn(), createInvitation: vi.fn(), revokeInvitation: vi.fn(), errorMessage: (error: Error) => error.message }));
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

const ownerOnly = {
  group: { id: 'friends', name: 'Friends', created_by: 'member' }, trips: [],
  members: [{ user_id: 'member', role: 'owner' as const, profiles: { display_name: 'Alex' } }],
};
const withInvitees = {
  ...ownerOnly,
  members: [...ownerOnly.members,
    { user_id: 'invitee', role: 'member' as const, profiles: { display_name: 'Sam' } },
    { user_id: 'unnamed', role: 'member' as const, profiles: { display_name: ' ' } },
  ],
};

it('explains when invitees appear and refreshes joined members and the count', async () => {
  let finishRefresh!: (value: typeof withInvitees) => void;
  vi.mocked(loadGroup).mockResolvedValueOnce(ownerOnly).mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
  mount();
  expect(await screen.findByText('Alex (you)')).toBeInTheDocument();
  expect(screen.getByText(/Invited people appear here after/)).toBeInTheDocument();
  expect(screen.getByText(/No one else has joined yet/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh members' }));
  expect(screen.getByRole('status')).toHaveTextContent('Refreshing group');
  expect(screen.getByRole('heading', { name: 'Friends' })).toBeInTheDocument();
  expect(screen.getByText('Alex (you)')).toBeInTheDocument();
  await act(async () => finishRefresh(withInvitees));
  const members = within(screen.getByRole('list', { name: 'Group members' }));
  expect(members.getByText('Sam')).toBeInTheDocument();
  expect(members.getByText('Traveler')).toBeInTheDocument();
  expect(members.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByText(/3 members · 0 trips/)).toBeInTheDocument();
  expect(screen.queryByText(/No one else has joined yet/)).not.toBeInTheDocument();
});

it('updates members when returning to the window and removes its listener on unmount', async () => {
  vi.mocked(loadGroup).mockResolvedValueOnce(ownerOnly).mockResolvedValueOnce(withInvitees);
  const view = mount();
  await screen.findByText('Alex (you)');
  act(() => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText('Sam')).toBeInTheDocument();
  view.unmount();
  vi.mocked(loadGroup).mockClear();
  act(() => window.dispatchEvent(new Event('focus')));
  expect(loadGroup).not.toHaveBeenCalled();
});

it('reports failed member refreshes and allows retrying', async () => {
  vi.mocked(loadGroup).mockResolvedValueOnce(ownerOnly).mockRejectedValueOnce(new Error('Members unavailable')).mockResolvedValueOnce(withInvitees);
  mount();
  await screen.findByText('Alex (you)');
  await userEvent.click(screen.getByRole('button', { name: 'Refresh members' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Members unavailable');
  expect(screen.getByRole('heading', { name: 'Friends' })).toBeInTheDocument();
  expect(screen.getByText('Alex (you)')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create invite link' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Sam')).toBeInTheDocument();
});

it('removes private group content and controls when access is revoked', async () => {
  vi.mocked(loadGroup).mockResolvedValueOnce(ownerOnly).mockRejectedValueOnce(new GroupAccessError());
  mount();
  await screen.findByText('Alex (you)');
  act(() => window.dispatchEvent(new Event('focus')));
  await screen.findByRole('alert');
  expect(screen.queryByText('Alex (you)')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Friends' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create a trip' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create invite link' })).not.toBeInTheDocument();
});

it('keeps the group visible after a session rejection and lets the member retry', async () => {
  vi.mocked(loadGroup).mockResolvedValueOnce(withInvitees)
    .mockRejectedValueOnce({ code: 'PGRST301', message: 'JWT expired', status: 401 })
    .mockResolvedValueOnce(withInvitees);
  mount();
  await screen.findByText('Sam');
  await userEvent.click(screen.getByRole('button', { name: 'Refresh members' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh this group: JWT expired');
  expect(screen.queryByText(/You must be a member/)).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Friends' })).toBeInTheDocument();
  expect(screen.getByText('Sam')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create a trip' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText('Sam')).toBeInTheDocument();
  expect(loadGroup).toHaveBeenCalledTimes(3);
});
