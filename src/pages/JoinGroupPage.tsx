import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { acceptInvitation, errorMessage } from '../lib/groups';

export function JoinGroupPage() {
  const { hash } = useLocation();
  const token = new URLSearchParams(hash.slice(1)).get('token') ?? '';
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = /^[a-f0-9]{64}$/.test(token);
  async function join() {
    if (busy) return;
    setBusy(true); setError('');
    try { navigate(`/groups/${await acceptInvitation(token)}`, { replace: true }); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Card className="mx-auto mt-12 max-w-lg p-8"><p className="text-sm uppercase tracking-widest text-ember">You’re invited</p><h1 className="mt-3 font-display text-4xl">Travel together.</h1><p className="my-5 text-ink/65">Join this private group to view its trips and photos and add your own memories.</p>
    {!valid ? <p role="alert">This invitation link is incomplete or invalid. Ask the owner for a new link.</p> : <Button onClick={join} disabled={busy}>{busy ? 'Joining…' : 'Join group'}</Button>}
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}<Link className="mt-6 block text-sm underline" to="/groups">Back to your groups</Link>
  </Card>;
}
