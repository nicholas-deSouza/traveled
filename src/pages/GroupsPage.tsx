import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Field } from '../components/ui/field';
import { createGroup, errorMessage, listGroups } from '../lib/groups';
import { useResource } from '../lib/useResource';

export function GroupsPage() {
  const navigate = useNavigate();
  const { data: groups, error, loading, reload } = useResource('groups', listGroups);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setFormError('');
    try { navigate(`/groups/${await createGroup(name.trim())}`); }
    catch (error) { setFormError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="py-8">
    <p className="text-sm font-medium uppercase tracking-[.18em] text-ember">Your people</p>
    <h1 className="mt-2 font-display text-5xl">Your groups</h1>
    <p className="mt-3 text-ink/65">A private home for your shared trips and photos. Only members can take part.</p>
    <Card className="mt-8 p-5"><form onSubmit={submit} className="flex flex-col items-start gap-4 sm:flex-row sm:items-end">
      <div className="w-full sm:max-w-sm"><Field label="New group name" value={name} onChange={event => setName(event.target.value)} maxLength={80} required placeholder="The wanderers" disabled={busy} /></div>
      <Button disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create group'}</Button>
    </form>{formError && <p className="mt-3 text-sm text-red-700" role="alert">{formError}</p>}</Card>
    {loading && <p className="mt-8" role="status">Loading your groups…</p>}
    {error && <p className="mt-8" role="alert">{error} <Button variant="outline" onClick={reload}>Retry</Button></p>}
    {groups?.length === 0 && <p className="mt-8 text-ink/65">No groups yet. Create one above, or open an invitation link from a friend.</p>}
    <div className="mt-6 grid gap-4 md:grid-cols-3">{groups?.map(group => <Link key={group.id} to={`/groups/${group.id}`} className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"><Card className="h-full p-6 hover:shadow-md"><h2 className="break-words font-display text-2xl">{group.name}</h2><p className="mt-4 text-sm text-moss">Open shared trips →</p></Card></Link>)}</div>
  </div>;
}
