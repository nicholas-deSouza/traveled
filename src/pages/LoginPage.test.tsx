import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

const auth = vi.hoisted(() => ({ signInWithPassword: vi.fn(), signInWithOtp: vi.fn() }));
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
});
it('shows authentication failures', async () => {
  auth.signInWithPassword.mockResolvedValue({ error: new Error('Invalid credentials') });
  render(<MemoryRouter><LoginPage /></MemoryRouter>);
  await userEvent.type(screen.getByLabelText('Email'), 'traveler@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'wrongpass');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
});
