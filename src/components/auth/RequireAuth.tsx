import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { errorMessage } from '../../lib/groups';

export function RequireAuth() {
  const location = useLocation();
  const [callbackError] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('error_description'));
  const [state, setState] = useState<{ loading: boolean; session: Session | null; error?: string }>({ loading: true, session: null });
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ loading: false, session });
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (active) setState({ loading: false, session: data.session, error: error ? errorMessage(error) : undefined });
    }).catch(error => { if (active) setState({ loading: false, session: null, error: errorMessage(error) }); });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  if (!supabase) return <div className="py-12"><h1 className="font-display text-4xl">Connect your shared atlas</h1><p className="mt-3">Groups require Supabase authentication and the database migrations. Follow the local setup in README.</p><Link className="mt-4 inline-block underline" to="/">Back to preview</Link></div>;
  if (callbackError) {
    const next = new URLSearchParams(location.search).get('next') || '/groups';
    return <div className="py-12"><p role="alert">Sign-in link unavailable: {callbackError}</p><Link className="mt-4 inline-block underline" to={`/login?next=${encodeURIComponent(next)}`}>Request a new sign-in link</Link></div>;
  }
  if (state.loading) return <p className="py-12" role="status">Signing you in…</p>;
  if (state.error) return <p className="py-12" role="alert">{state.error} <Link to="/login" className="underline">Return to sign in</Link></p>;
  if (!state.session) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} replace />;
  return <Outlet key={state.session.user.id} context={state.session} />;
}
