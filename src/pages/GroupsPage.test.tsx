import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { createGroup, listGroups } from '../lib/groups';
import { GroupsPage } from './GroupsPage';

vi.mock('../lib/groups', () => ({ createGroup: vi.fn(), listGroups: vi.fn(), errorMessage: (error: Error) => error.message }));
it('creates a group with a trimmed name and navigates to it', async () => {
  vi.mocked(listGroups).mockResolvedValue([]);
  vi.mocked(createGroup).mockResolvedValue('new-group');
  render(<MemoryRouter><Routes><Route path="/" element={<GroupsPage />} /><Route path="/groups/new-group" element={<p>New group details</p>} /></Routes></MemoryRouter>);
  expect(screen.getByRole('button', { name: 'Create group' })).toBeDisabled();
  expect(await screen.findByText(/No groups yet/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('New group name'), '  Friends  ');
  await userEvent.click(screen.getByRole('button', { name: 'Create group' }));
  expect(createGroup).toHaveBeenCalledWith('Friends');
  expect(await screen.findByText('New group details')).toBeInTheDocument();
});
it('retries a failed group list', async () => {
  vi.mocked(listGroups).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue([{ id: 'friends', name: 'Friends', created_by: 'owner' }]);
  render(<MemoryRouter><GroupsPage /></MemoryRouter>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('link', { name: /Friends/ })).toHaveAttribute('href', '/groups/friends');
});
