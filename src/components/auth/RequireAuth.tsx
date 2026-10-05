import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/groups';
import { PhotoUploadProvider } from '../photos/PhotoUploadProvider';
import { bindInvitation, forgetInvitation, pendingInvitation, rememberInvitation } from '../../lib/pendingInvitation';

export function RequireAuth() {
  const location = useLocation();
  const lastUser = useRef<string | null>(null);
  const [callbackError] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('error_description'));
  const [state, setState] = useState<{ loading: boolean; session: Session | null; error?: string }>({ loading: true, session: null });
  useEffect(() => {
    if (location.pathname === '/join') rememberInvitation(location.pathname + location.hash);
  }, [location.pathname, location.hash]);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let receivedAuthEvent = false;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      receivedAuthEvent = true;
      if (active) {
        if (event === 'SIGNED_OUT') {
          if (lastUser.current) bindInvitation(lastUser.current);
          else forgetInvitation();
        }
        else if (session) { lastUser.current = session.user.id; bindInvitation(session.user.id); }
        setState({ loading: false, session });
      }
    });
    supabase.auth.getSession().then(({ data, error }) => {
      // A late initial snapshot must not restore an account after a newer
      // sign-out or account-switch event has already updated the UI.
      if (active && !receivedAuthEvent) {
        if (data.session) { lastUser.current = data.session.user.id; bindInvitation(data.session.user.id); }
        setState({ loading: false, session: data.session, error: error ? errorMessage(error) : undefined });
      }
    }).catch(error => { if (active && !receivedAuthEvent) setState({ loading: false, session: null, error: errorMessage(error) }); });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  if (!supabase) return <div className="py-12"><h1 className="font-display text-4xl">Connect your shared atlas</h1><p className="mt-3">Groups require Supabase authentication and the database migrations. Follow the local setup in README.</p><Link className="mt-4 inline-block underline" to="/">Back to home</Link></div>;
  if (callbackError) {
    const next = new URLSearchParams(location.search).get('next') || '/';
    return <div className="py-12"><p role="alert">Sign-in link unavailable: {callbackError}</p><Link className="mt-4 inline-block underline" to={`/login?next=${encodeURIComponent(next)}`}>Request a new sign-in link</Link></div>;
  }
  if (state.loading) return <p className="py-12" role="status">Signing you in…</p>;
  if (state.error) return <p className="py-12" role="alert">{state.error} <Link to="/login" className="underline">Return to sign in</Link></p>;
  if (!state.session) {
    const params = new URLSearchParams({ next: location.pathname + location.search + location.hash });
    if (lastUser.current) params.set('nextUser', lastUser.current);
    return <Navigate to={`/login?${params}`} replace />;
  }
  const invitation = pendingInvitation();
  if (location.pathname === '/' && invitation) return <Navigate to={invitation} replace />;
  return <PhotoUploadProvider key={state.session.user.id} userId={state.session.user.id}><Outlet context={state.session} /></PhotoUploadProvider>;
}
