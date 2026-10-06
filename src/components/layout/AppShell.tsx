import { Compass, MapPinned, Users } from "lucide-react";
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { supabase } from '../../lib/supabase';
import { forgetInvitation } from '../../lib/pendingInvitation';

const navItems = [
  { to: "/", label: "Explore", icon: Compass },
  { to: "/groups", label: "Groups", icon: Users },
];

export function AppShell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeNavIndex = navItems.findIndex(({ to }) =>
    to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
    });
    return () => subscription.unsubscribe();
  }, []);
  async function signOut() {
    if (!supabase || busy) return;
    setBusy(true); setError('');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      forgetInvitation();
      navigate('/login', { replace: true });
    } catch { setError('Could not sign out. Please try again.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="min-h-screen p-3 md:p-5">
      <header className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] items-center gap-2 rounded-2xl border border-ink/10 bg-white/80 px-3 py-3 backdrop-blur sm:flex sm:flex-wrap sm:justify-between sm:px-4 md:px-5">
        <Link to="/" className="flex min-h-11 items-center gap-2 font-display text-xl tracking-tight sm:text-2xl"><MapPinned className="h-5 w-5 text-ember" /> Traveled</Link>
        <nav aria-label="Main navigation" className="relative isolate order-last col-span-2 grid grid-cols-2 items-center gap-1 sm:order-none">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 -z-10 w-[calc((100%-0.25rem)/2)] rounded-full bg-ink transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{
              transform: activeNavIndex === 1 ? 'translateX(calc(100% + 0.25rem))' : 'translateX(0)',
              opacity: activeNavIndex === -1 ? 0 : 1,
            }}
          />
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => cn(
                "flex min-h-11 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 motion-reduce:transition-none sm:min-h-9",
                isActive ? "text-white" : "text-ink/65 hover:bg-ink/5",
              )}
            ><Icon aria-hidden="true" className="h-4 w-4" />{label}</NavLink>
          ))}
        </nav>
        {signedIn
          ? <div className="flex items-center gap-1"><Button size="sm" variant="ghost" asChild><Link to="/account/password">Password</Link></Button><Button size="sm" variant="ghost" disabled={busy} onClick={signOut}>{busy ? 'Signing out…' : 'Sign out'}</Button></div>
          : <Button size="sm" asChild><Link to="/login">Sign in</Link></Button>}
      </header>
      <main className="mx-auto max-w-7xl">{error && <p role="alert" className="mt-4 text-red-700">{error}</p>}<Outlet /></main>
    </div>
  );
}
