import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { PasswordPage } from './PasswordPage';

const updateUser = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { auth: { updateUser } } }));
vi.mock('../lib/useSession', () => ({ useSession: () => ({ user: { id: 'member', email: 'traveler@example.com' } }) }));
it('rejects mismatched confirmation without updating the account', async () => {
  render(<MemoryRouter><PasswordPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('New password'), 'password123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'different123');
  await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
  expect(updateUser).not.toHaveBeenCalled();
});
it('saves matching passwords and offers the requested destination', async () => {
  updateUser.mockResolvedValue({ error: null });
  render(<MemoryRouter initialEntries={['/account/password?next=%2Fjoin']}><PasswordPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('New password'), 'password123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('heading', { name: 'Password saved.' })).toBeInTheDocument();
  expect(updateUser).toHaveBeenCalledWith({ password: 'password123' });
  expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/join');
});
