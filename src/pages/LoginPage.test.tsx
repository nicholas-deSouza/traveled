import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signInWithOtp: vi.fn(), resetPasswordForEmail: vi.fn() }));
vi.mock('../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { auth } }));
it('signs in and opens the authentication callback', async () => {
  auth.signInWithPassword.mockResolvedValue({ error: null });
  render(<MemoryRouter initialEntries={['/login?next=%2Fjoin']}><Routes><Route path="/login" element={<LoginPage />} /><Route path="/auth/callback" element={<p>Signed in</p>} /></Routes></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Email'), 'traveler@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'secret123');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'traveler@example.com', password: 'secret123' });
  expect(await screen.findByText('Signed in')).toBeInTheDocument();
});
it('switches to magic links and displays delivery confirmation', async () => {
  auth.signInWithOtp.mockResolvedValue({ error: null });
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: 'Use a magic link instead' }));
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Email'), 'traveler@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Send magic link' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Check your email');
  expect(auth.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ shouldCreateUser: false }) }));
});

it('asks new users for a name and sends it with signup metadata', async () => {
  auth.signInWithOtp.mockResolvedValue({ error: null });
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: 'Create an account' }));
  expect(screen.getByLabelText('Your name')).toBeRequired();
  await userEvent.type(screen.getByLabelText('Your name'), 'José García');
  await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Send signup link' }));
  expect(auth.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@example.com', options: expect.objectContaining({ shouldCreateUser: true, data: { display_name: 'José García' } }) }));
  expect(await screen.findByRole('status')).toHaveTextContent('Check your email');
});

it.each(['', 'Fuck You'])('rejects invalid signup names before calling authentication: %s', name => {
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Send signup link' }).closest('form')!);
  expect(screen.getByRole('alert')).toHaveTextContent(name ? 'without explicit words or phrases' : 'Enter a name');
  expect(auth.signInWithOtp).not.toHaveBeenCalled();
});
it('shows authentication failures', async () => {
  auth.signInWithPassword.mockResolvedValue({ error: new Error('Invalid credentials') });
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Email'), 'traveler@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'wrongpass');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
});

it('never opens protected content when password authentication fails', async () => {
  auth.signInWithPassword.mockResolvedValue({ error: new Error('Invalid credentials') });
  render(<MemoryRouter initialEntries={['/login']}><Routes><Route path="/login" element={<LoginPage />} /><Route path="/auth/callback" element={<p>Private account</p>} /></Routes></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Email'), 'someone-else@example.com');
  await userEvent.type(screen.getByLabelText('Password'), "' OR 1=1; DROP TABLE profiles;--");
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  expect(screen.queryByText('Private account')).not.toBeInTheDocument();
  expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'someone-else@example.com', password: "' OR 1=1; DROP TABLE profiles;--" });
});

it.each(['password', 'magic-link', 'reset'] as const)('explains the ASCII email restriction in %s mode even when native validation is bypassed', async mode => {
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  if (mode === 'magic-link') await userEvent.click(screen.getByRole('button', { name: 'Use a magic link instead' }));
  if (mode === 'reset') await userEvent.click(screen.getByRole('button', { name: 'Set or reset password' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'josé@example.com' } });
  fireEvent.submit(screen.getByRole('button', { name: mode === 'password' ? 'Sign in' : mode === 'reset' ? 'Send password setup link' : 'Send magic link' }).closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address using only ASCII characters.');
  expect(auth.signInWithPassword).not.toHaveBeenCalled();
  expect(auth.signInWithOtp).not.toHaveBeenCalled();
  expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
});

it('sends password recovery with a safe callback without disclosing account existence', async () => {
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  render(<MemoryRouter initialEntries={['/login?next=https%3A%2F%2Fevil.example']}><LoginPage /></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: 'Set or reset password' }));
  await userEvent.type(screen.getByLabelText('Email'), 'traveler@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Send password setup link' }));
  const redirect = new URL(auth.resetPasswordForEmail.mock.calls[0][1].redirectTo);
  expect(redirect.origin).toBe(window.location.origin);
  expect(redirect.pathname).toBe('/auth/callback');
  expect(redirect.searchParams.get('intent')).toBe('password');
  expect(redirect.searchParams.get('next')).toBe('/');
  expect(await screen.findByRole('status')).toHaveTextContent('If an account exists');
  expect(auth.signInWithOtp).not.toHaveBeenCalled();
});

it('blocks duplicate login and mode changes while authentication is pending', async () => {
  let finish!: (result: { error: null }) => void;
  auth.signInWithPassword.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  render(<MemoryRouter initialEntries={['/login']}><Routes><Route path="/login" element={<LoginPage />} /><Route path="/auth/callback" element={<p>Signed in</p>} /></Routes></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Email'), 'traveler@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Use a magic link instead' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Signing in…' }));
  expect(auth.signInWithPassword).toHaveBeenCalledOnce();
  finish({ error: null });
  expect(await screen.findByText('Signed in')).toBeInTheDocument();
});
