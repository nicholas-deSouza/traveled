import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useOutletContext } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { RequireAuth } from './RequireAuth';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), unsubscribe: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: {
  getSession: auth.getSession,
  onAuthStateChange: auth.onAuthStateChange,
} } }));
vi.mock('../photos/PhotoUploadProvider', () => ({ PhotoUploadProvider: ({ children }: { children: ReactNode }) => children }));
beforeEach(() => {
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: auth.unsubscribe } } });
});
function mount() {
  return render(<MemoryRouter initialEntries={['/groups']}><Routes>
    <Route element={<RequireAuth />}><Route path="/groups" element={<p>Private groups</p>} /></Route>
    <Route path="/login" element={<p>Login</p>} />
  </Routes></MemoryRouter>);
}

function AccountContent() {
  const { user } = useOutletContext<{ user: { id: string } }>();
  const [clicks, setClicks] = useState(0);
  return <button onClick={() => setClicks(count => count + 1)}>{user.id}: {clicks}</button>;
}

function mountAccount() {
  return render(<MemoryRouter initialEntries={['/groups']}><Routes>
    <Route element={<RequireAuth />}><Route path="/groups" element={<AccountContent />} /></Route>
    <Route path="/login" element={<p>Login</p>} />
  </Routes></MemoryRouter>);
}
it('redirects anonymous visitors to login', async () => {
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mount();
  expect(await screen.findByText('Login')).toBeInTheDocument();
});
it('renders protected content for a session and unsubscribes on unmount', async () => {
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'member' } } }, error: null });
  const { unmount } = mount();
  expect(await screen.findByText('Private groups')).toBeInTheDocument();
  unmount();
  expect(auth.unsubscribe).toHaveBeenCalledOnce();
});
it('surfaces session errors', async () => {
  auth.getSession.mockRejectedValue(new Error('Session unavailable'));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Session unavailable');
});

it.each(['session', 'anonymous'] as const)('uses INITIAL_SESSION with an %s result before a late session lookup', async result => {
  let finish!: (result: { data: { session: { user: { id: string } } | null }; error: null }) => void;
  auth.getSession.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  mountAccount();
  expect(screen.getByRole('status')).toHaveTextContent('Signing you in');
  const notify = auth.onAuthStateChange.mock.calls[0][0];
  act(() => notify('INITIAL_SESSION', result === 'session' ? { user: { id: 'current-account' } } : null));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  if (result === 'session') expect(screen.getByRole('button', { name: 'current-account: 0' })).toBeInTheDocument();
  else expect(screen.getByText('Login')).toBeInTheDocument();

  await act(async () => finish({ data: { session: result === 'session' ? null : { user: { id: 'stale-account' } } }, error: null }));
  if (result === 'session') expect(screen.getByRole('button', { name: 'current-account: 0' })).toBeInTheDocument();
  else expect(screen.getByText('Login')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /stale-account/ })).not.toBeInTheDocument();
});

it('clears protected page state when the account changes and redirects after sign-out', async () => {
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'account-a' } } }, error: null });
  mountAccount();
  await userEvent.click(await screen.findByRole('button', { name: 'account-a: 0' }));
  expect(screen.getByRole('button', { name: 'account-a: 1' })).toBeInTheDocument();
  const notify = auth.onAuthStateChange.mock.calls[0][0];
  act(() => notify('SIGNED_IN', { user: { id: 'account-b' } }));
  expect(await screen.findByRole('button', { name: 'account-b: 0' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /account-a/ })).not.toBeInTheDocument();
  act(() => notify('SIGNED_OUT', null));
  expect(await screen.findByText('Login')).toBeInTheDocument();
});

it.each(['switch', 'sign-out'])('does not restore a stale initial session after %s', async event => {
  let finish!: (result: { data: { session: { user: { id: string } } }; error: null }) => void;
  auth.getSession.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  mountAccount();
  expect(screen.getByRole('status')).toHaveTextContent('Signing you in');
  const notify = auth.onAuthStateChange.mock.calls[0][0];
  act(() => notify(event === 'switch' ? 'SIGNED_IN' : 'SIGNED_OUT', event === 'switch' ? { user: { id: 'account-b' } } : null));
  await act(async () => finish({ data: { session: { user: { id: 'account-a' } } }, error: null }));
  expect(screen.queryByRole('button', { name: /account-a/ })).not.toBeInTheDocument();
  if (event === 'switch') expect(screen.getByRole('button', { name: 'account-b: 0' })).toBeInTheDocument();
  else expect(screen.getByText('Login')).toBeInTheDocument();
});
