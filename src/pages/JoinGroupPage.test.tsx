import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { acceptInvitation } from '../lib/groups';
import { JoinGroupPage } from './JoinGroupPage';

vi.mock('../lib/groups', () => ({ acceptInvitation: vi.fn(), errorMessage: (error: Error) => error.message }));
it('rejects invalid invitation links', () => {
  render(<MemoryRouter><JoinGroupPage /></MemoryRouter>);
  expect(screen.getByRole('alert')).toHaveTextContent('incomplete or invalid');
  expect(screen.queryByRole('button', { name: 'Join group' })).not.toBeInTheDocument();
  expect(acceptInvitation).not.toHaveBeenCalled();
});
it('accepts the token and opens the group', async () => {
  const token = 'a'.repeat(64);
  vi.mocked(acceptInvitation).mockResolvedValue('friends');
  render(<MemoryRouter initialEntries={[`/join#token=${token}`]}><Routes><Route path="/join" element={<JoinGroupPage />} /><Route path="/groups/friends" element={<p>Joined friends</p>} /></Routes></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: 'Join group' }));
  expect(acceptInvitation).toHaveBeenCalledWith(token);
  expect(await screen.findByText('Joined friends')).toBeInTheDocument();
});
