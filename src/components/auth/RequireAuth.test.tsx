import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { RequireAuth } from './RequireAuth';

const auth = vi.hoisted(() => ({ getSession: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: {
  getSession: auth.getSession,
  onAuthStateChange: () => ({ data: { subscription: { unsubscribe: auth.unsubscribe } } }),
} } }));
function mount() {
  return render(<MemoryRouter initialEntries={['/groups']}><Routes>
    <Route element={<RequireAuth />}><Route path="/groups" element={<p>Private groups</p>} /></Route>
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
