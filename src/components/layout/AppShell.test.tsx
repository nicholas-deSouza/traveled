import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AppShell } from './AppShell';
import { pendingInvitation, rememberInvitation } from '../../lib/pendingInvitation';

const auth = vi.hoisted(() => ({ onAuthStateChange: vi.fn<(callback: (event: string, session: object | null) => void) => { data: { subscription: { unsubscribe: () => void } } }>(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })), signOut: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth } }));
afterEach(() => window.localStorage.removeItem('traveled:pending-invitation'));

function LoginResult() { const location = useLocation(); return <p>Signed out{location.search}</p>; }

it('provides navigation, sign-in, and the nested page', () => {
  render(<MemoryRouter initialEntries={['/groups']}><Routes><Route element={<AppShell />}><Route path="/groups" element={<p>Your trips</p>} /></Route></Routes></MemoryRouter>);
  expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Groups' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  expect(screen.getByRole('main')).toHaveTextContent('Your trips');
});

it('clears invitations and return destinations when the user deliberately signs out', async () => {
  rememberInvitation(`/join#token=${'a'.repeat(64)}`);
  auth.signOut.mockResolvedValue({ error: null });
  render(<MemoryRouter initialEntries={['/groups']}><Routes><Route element={<AppShell />}><Route path="/groups" element={<p>Your trips</p>} /></Route><Route path="/login" element={<LoginResult />} /></Routes></MemoryRouter>);
  const notify = auth.onAuthStateChange.mock.calls[0][0] as (event: string, session: object) => void;
  act(() => notify('SIGNED_IN', { user: { id: 'member' } }));
  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(await screen.findByText('Signed out')).toBeInTheDocument();
  expect(pendingInvitation()).toBeNull();
});
