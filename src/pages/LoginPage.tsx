import { useState, type SubmitEvent } from 'react';
import { MapPinned } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { errorMessage } from '../lib/groups';
import { authDestination } from '../lib/authRedirect';

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'password' | 'magic-link' | 'reset'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      // Reuse the callback's destination validation for both sign-in methods.
      const redirect = new URL('/auth/callback', window.location.origin);
      redirect.searchParams.set('next', authDestination(params.get('next')));

      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setPassword('');
        navigate(redirect.pathname + redirect.search, { replace: true });
      } else if (mode === 'reset') {
        redirect.searchParams.set('intent', 'password');
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect.toString() });
        if (error) throw error;
        setMessage('If an account exists for this email, you’ll receive a link to set a new password.');
      } else {
        redirect.searchParams.set('intent', 'password');
        // Keep the destination in the query: Supabase uses the fragment for the session.
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: redirect.toString() },
        });
        if (error) throw error;
        setMessage('Check your email for a sign-in link. It will bring you back to continue.');
      }
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function switchMode(nextMode: typeof mode) {
    setMode(nextMode);
    setPassword('');
    setMessage('');
    setError('');
  }

  return (
    <main className="grid min-h-screen place-items-center bg-ink p-5">
      <section className="w-full max-w-md rounded-3xl bg-mist p-7 md:p-10">
        <MapPinned className="mb-8 h-8 w-8 text-ember" />
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-ember">Traveled</p>
        <h1 className="mt-2 font-display text-5xl">{mode === 'reset' ? 'Set a password.' : 'Good to see you.'}</h1>
        <p className="mt-3 text-sm leading-6 text-ink/65">
          {mode === 'password'
            ? 'Sign in with your email and password to see your trips.'
            : mode === 'reset'
              ? 'We’ll email you a one-time link to set or reset your password. After that, sign in with your password.'
              : 'Sign in or create an account with an email link, then choose a password for next time.'}
        </p>
        <form className="mt-8 space-y-4" onSubmit={submit} aria-busy={busy}>
          <Field label="Email" type="email" autoComplete="email" name="email" required placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
          {mode === 'password' && (
            <Field label="Password" type="password" autoComplete="current-password" name="password" required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
          )}
          <Button className="w-full" disabled={busy || !isSupabaseConfigured}>
            {mode === 'password' ? (busy ? 'Signing in…' : 'Sign in') : (busy ? 'Sending…' : mode === 'reset' ? 'Send password setup link' : 'Send magic link')}
          </Button>
        </form>
        {message && <p className="mt-4 text-sm" role="status">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
        <div className="mt-5 text-center">
          {mode === 'password' && <>
            <button type="button" onClick={() => switchMode('reset')} disabled={busy} className="mb-4 rounded text-sm text-moss underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 disabled:opacity-50">Set or reset password</button>
            <p className="mb-2 text-xs leading-5 text-ink/65">New here? Start with a magic link to verify your email and set a password.</p>
          </>}
          <button type="button" onClick={() => switchMode(mode === 'password' ? 'magic-link' : 'password')} disabled={busy} className="rounded text-sm text-moss underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember focus-visible:ring-offset-2 disabled:opacity-50">
            {mode === 'password' ? 'Use a magic link instead' : 'Sign in with a password'}
          </button>
        </div>
        {!isSupabaseConfigured && <p className="mt-4 text-xs leading-5 text-ink/55">Follow the Supabase setup in README to enable authentication.</p>}
        <Link to="/" className="mt-6 block text-center text-sm text-moss hover:underline">Back to Traveled</Link>
      </section>
    </main>
  );
}
