import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { PasswordPage } from './PasswordPage';
import { saveDisplayName } from '../lib/profiles';

const updateUser = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { auth: { updateUser } } }));
vi.mock('../lib/profiles', () => ({ saveDisplayName: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/useSession', () => ({ useSession: () => ({ user: { id: 'member', email: 'traveler@example.com' } }) }));
it('rejects mismatched confirmation without updating the account', async () => {
  render(<MemoryRouter><PasswordPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Your name'), 'Alex');
  await userEvent.type(screen.getByLabelText('New password'), 'password123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'different123');
  await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
  expect(updateUser).not.toHaveBeenCalled();
});
it('saves matching passwords and offers the requested destination', async () => {
  updateUser.mockResolvedValue({ error: null });
  render(<MemoryRouter initialEntries={['/account/password?next=%2Fjoin']}><PasswordPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Your name'), 'Alex');
  await userEvent.type(screen.getByLabelText('New password'), 'password123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('heading', { name: 'Password saved.' })).toBeInTheDocument();
  expect(saveDisplayName).toHaveBeenCalledWith('member', 'Alex');
  expect(updateUser).toHaveBeenCalledWith({ password: 'password123', data: { display_name: 'Alex' } });
  expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/join');
});

it('rejects explicit names before saving a profile or password', async () => {
  render(<MemoryRouter><PasswordPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Your name'), 'Fuck You');
  await userEvent.type(screen.getByLabelText('New password'), 'password123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('without explicit words or phrases');
  expect(saveDisplayName).not.toHaveBeenCalled();
  expect(updateUser).not.toHaveBeenCalled();
});

it('reports profile save failures and keeps the invitation destination', async () => {
  updateUser.mockResolvedValue({ error: null });
  vi.mocked(saveDisplayName).mockRejectedValueOnce(new Error('Name unavailable'));
  render(<MemoryRouter initialEntries={['/account/password?next=%2Fjoin']}><PasswordPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Your name'), 'Alex');
  await userEvent.type(screen.getByLabelText('New password'), 'password123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your password was saved, but your profile name could not be updated');
  expect(updateUser).toHaveBeenCalledWith({ password: 'password123', data: { display_name: 'Alex' } });
  expect(screen.getByRole('heading', { name: 'Password saved.' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/join');
});

it('lets an existing user recover a password without providing a profile name', async () => {
  updateUser.mockResolvedValue({ error: null });
  render(<MemoryRouter><PasswordPage /></MemoryRouter>);
  expect(screen.getByLabelText('Your name')).not.toBeRequired();
  await userEvent.type(screen.getByLabelText('New password'), 'password123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('heading', { name: 'Password saved.' })).toBeInTheDocument();
  expect(updateUser).toHaveBeenCalledWith({ password: 'password123' });
  expect(saveDisplayName).not.toHaveBeenCalled();
});

it('does not change the profile when password recovery fails', async () => {
  updateUser.mockResolvedValueOnce({ error: new Error('Recovery session expired') });
  render(<MemoryRouter><PasswordPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Your name'), 'Alex');
  await userEvent.type(screen.getByLabelText('New password'), 'password123');
  await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Recovery session expired');
  expect(saveDisplayName).not.toHaveBeenCalled();
});
