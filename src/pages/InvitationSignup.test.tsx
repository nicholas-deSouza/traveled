import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { RequireAuth } from '../components/auth/RequireAuth';
import { LoginPage } from './LoginPage';
import { AuthCallbackPage } from './AuthCallbackPage';
import { PasswordPage } from './PasswordPage';
import { JoinGroupPage } from './JoinGroupPage';
import { acceptInvitation } from '../lib/groups';
import { pendingInvitation } from '../lib/pendingInvitation';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn(), signInWithOtp: vi.fn(), updateUser: vi.fn() }));
vi.mock('../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: { auth } }));
vi.mock('../components/photos/PhotoUploadProvider', () => ({ PhotoUploadProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock('../lib/groups', () => ({ acceptInvitation: vi.fn(), errorMessage: (error: Error) => error.message }));
vi.mock('../lib/profiles', () => ({ saveDisplayName: vi.fn().mockResolvedValue(undefined) }));
afterEach(() => window.localStorage.removeItem('traveled:pending-invitation'));

function mount(url: string) {
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  return render(<MemoryRouter initialEntries={[url]}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<RequireAuth />}>
      <Route path="/join" element={<JoinGroupPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/account/password" element={<PasswordPage />} />
      <Route path="/" element={<p>Your dashboard</p>} />
      <Route path="/groups/friends" element={<p>Joined friends</p>} />
      <Route path="/groups" element={<p>Your groups</p>} />
    </Route>
  </Routes></MemoryRouter>);
}

const token = 'c'.repeat(64);
it.each(['callback', 'callback without next', 'site root'] as const)('restores Join group after new-account verification returns to %s', async destination => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  auth.signInWithOtp.mockResolvedValue({ error: null });
  const signup = mount(`/join#token=${token}`);
  await userEvent.click(await screen.findByRole('button', { name: 'Create an account' }));
  await userEvent.type(screen.getByLabelText('Your name'), 'Casey');
  await userEvent.type(screen.getByLabelText('Email'), 'new@example.com');
  await userEvent.click(screen.getByRole('button', { name: 'Send signup link' }));
  await screen.findByRole('status');
  const callback = new URL(auth.signInWithOtp.mock.calls[0][0].options.emailRedirectTo);
  expect(callback.searchParams.get('next')).toBe(`/join#token=${token}`);
  expect(auth.signInWithOtp.mock.calls[0][0].options.data).toEqual({ display_name: 'Casey' });
  expect(pendingInvitation()).toBe(`/join#token=${token}`);
  signup.unmount();

  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'new-user', email: 'new@example.com', user_metadata: { display_name: 'Casey' } } } }, error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  vi.mocked(acceptInvitation).mockResolvedValue('friends');
  mount(destination === 'site root' ? '/' : destination === 'callback without next' ? '/auth/callback?intent=password' : callback.pathname + callback.search);
  if (destination !== 'site root') {
    await userEvent.type(await screen.findByLabelText('New password'), 'password123');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Save password' }));
    await userEvent.click(await screen.findByRole('link', { name: 'Continue' }));
  }
  const join = await screen.findByRole('button', { name: 'Join group' });
  expect(acceptInvitation).not.toHaveBeenCalled();
  await userEvent.click(join);
  expect(acceptInvitation).toHaveBeenCalledWith(token);
  expect(await screen.findByText('Joined friends')).toBeInTheDocument();
  expect(pendingInvitation()).toBeNull();
});

it('lets an invitee leave an expired invitation without being redirected back', async () => {
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'new-user' } } }, error: null });
  vi.mocked(acceptInvitation).mockRejectedValue(new Error('Invitation expired'));
  mount(`/join#token=${token}`);
  await userEvent.click(await screen.findByRole('button', { name: 'Join group' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invitation expired');
  await userEvent.click(screen.getByRole('link', { name: 'Back to your groups' }));
  expect(await screen.findByText('Your groups')).toBeInTheDocument();
  expect(pendingInvitation()).toBeNull();
});
