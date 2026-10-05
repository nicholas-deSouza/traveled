import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { authDestination } from '../lib/authRedirect';
import { errorMessage } from '../lib/groups';
import { loadDisplayName, saveDisplayName } from '../lib/profiles';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/useSession';
import { pendingInvitation } from '../lib/pendingInvitation';
import { displayName } from '../lib/displayName';

export function PasswordPage() {
  const session = useSession();
  const [params] = useSearchParams();
  const next = authDestination(params.get('next') || pendingInvitation());
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const editedName = useRef(false);
  const [pendingName, setPendingName] = useState<string>();
  const [nameMessage, setNameMessage] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    loadDisplayName(session.user.id).then(value => {
      if (!active || editedName.current || !value || value === 'Traveler') return;
      try { setName(displayName(value)); } catch { /* An old invalid name must not block recovery. */ }
    }).catch(() => { /* Names are optional; password recovery remains available. */ });
    return () => { active = false; };
  }, [session.user.id]);

  async function saveName(value: string) {
    try {
      await saveDisplayName(session.user.id, value);
      setPendingName(undefined); setNameMessage('Your profile name was saved.');
    } catch {
      setPendingName(value);
      setError('Your password was saved, but your profile name could not be updated. Retry saving your name below.');
    }
  }

  async function retryName() {
    if (!pendingName || busy) return;
    setBusy(true); setError('');
    try { await saveName(pendingName); } finally { setBusy(false); }
  }

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
      const validName = name.trim() ? displayName(name) : undefined;
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setConfirmation('');
      setSaved(true);
      if (validName) await saveName(validName);
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
          {pendingName && <Button onClick={retryName} disabled={busy} variant="outline" className="mt-4">{busy ? 'Saving name…' : 'Retry saving name'}</Button>}
          {nameMessage && <p className="mt-3 text-sm" role="status">{nameMessage}</p>}
          <Button asChild className="mt-6 w-full"><Link to={next}>Continue</Link></Button>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm leading-6 text-ink/65">Choose a password for {session.user.email} so you can sign in without an email link. You can also replace an existing password here.</p>
          <form onSubmit={submit} className="mt-6 space-y-4" aria-busy={busy}>
            <Field label="Your name" autoComplete="name" name="display_name" maxLength={80} value={name} onChange={event => { editedName.current = true; setName(event.target.value); }} disabled={busy} />
            <p className="text-xs text-ink/65">Your name is optional when changing your password.</p>
            <input type="hidden" name="username" autoComplete="username" value={session.user.email || ''} />
            <Field label="New password" type="password" name="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} aria-describedby="password-help" />
            <p id="password-help" className="text-xs text-ink/65">Use at least 8 characters.</p>
            <Field label="Confirm password" type="password" name="confirm-password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} />
            <Button className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</Button>
          </form>
          {!busy && <Link to={next} className="mt-5 block rounded text-center text-sm text-moss hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">Continue without changing password</Link>}
        </>
      )}
      {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
    </section>
  );
}
