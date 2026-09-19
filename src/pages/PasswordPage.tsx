import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { authDestination } from '../lib/authRedirect';
import { errorMessage } from '../lib/groups';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/useSession';

export function PasswordPage() {
  const session = useSession();
  const [params] = useSearchParams();
  const next = authDestination(params.get('next'));
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    setError('');
    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('Your passwords do not match. Please try again.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setConfirmation('');
      setSaved(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto my-10 max-w-md rounded-3xl border border-ink/10 bg-mist p-7 md:p-10">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-ember">Your account</p>
      <h1 className="mt-2 font-display text-4xl">{saved ? 'Password saved.' : 'Set your password.'}</h1>
      {saved ? (
        <>
          <p className="mt-4 text-sm leading-6 text-ink/65" role="status">You can now sign in with {session.user.email} and your password.</p>
          <Button asChild className="mt-6 w-full"><Link to={next}>Continue</Link></Button>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm leading-6 text-ink/65">Choose a password for {session.user.email} so you can sign in without an email link. You can also replace an existing password here.</p>
          <form onSubmit={submit} className="mt-6 space-y-4" aria-busy={busy}>
            <input type="hidden" name="username" autoComplete="username" value={session.user.email || ''} />
            <Field label="New password" type="password" name="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} aria-describedby="password-help" />
            <p id="password-help" className="text-xs text-ink/65">Use at least 8 characters.</p>
            <Field label="Confirm password" type="password" name="confirm-password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
            <Button className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</Button>
          </form>
          {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
          {!busy && <Link to={next} className="mt-5 block rounded text-center text-sm text-moss hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">Continue without changing password</Link>}
        </>
      )}
    </section>
  );
}
