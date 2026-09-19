import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Field } from '../components/ui/field';
import { createInvitation, createTrip, errorMessage, loadGroup, revokeInvitation } from '../lib/groups';
import { useResource } from '../lib/useResource';
import { useSession } from '../lib/useSession';

export function GroupDetailPage() {
  const { groupId = '' } = useParams();
  return <GroupContent key={groupId} groupId={groupId} />;
}

function GroupContent({ groupId }: { groupId: string }) {
  const { user } = useSession();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useResource(groupId, loadGroup);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [formError, setFormError] = useState('');
  const [invitation, setInvitation] = useState<{ url: string; expires: string }>();
  const [values, setValues] = useState({ title: '', description: '', starts_on: '', ends_on: '' });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !values.title.trim()) return;
    if (values.starts_on && values.ends_on && values.ends_on < values.starts_on) { setFormError('The end date must be on or after the start date.'); return; }
    setBusy(true); setFormError('');
    try { navigate(`/trips/${await createTrip(groupId, user.id, values)}`); }
    catch (error) { setFormError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function manageInvite(revoke: boolean) {
    if (inviteBusy) return;
    setInviteBusy(true); setMessage(''); setInviteError('');
    try {
      if (revoke) { await revokeInvitation(groupId); setInvitation(undefined); setMessage('Invitation revoked. Existing members keep their access.'); }
      else {
        const result = await createInvitation(groupId);
        setInvitation({ url: `${window.location.origin}/join#token=${result.token}`, expires: new Date(result.expires_at).toLocaleString() });
        setMessage('New invitation ready. Previous links no longer work.');
      }
    } catch (error) { setInviteError(errorMessage(error)); }
    finally { setInviteBusy(false); }
  }
  async function copy() {
    if (!invitation) return;
    try { await navigator.clipboard.writeText(invitation.url); setMessage('Invitation link copied.'); }
    catch { setMessage('Select the invitation link and copy it manually.'); }
  }
  if (loading) return <p className="py-12" role="status">Loading group…</p>;
  if (error || !data) return <div className="py-12"><p role="alert">{error}</p><Button onClick={reload} variant="outline" className="mt-4">Retry</Button><Link to="/groups" className="ml-4 underline">Your groups</Link></div>;
  const { group, trips, members } = data;
  return <div className="py-8">
    <Link to="/groups" className="text-sm text-moss hover:underline">← Your groups</Link>
    <div className="mt-4 flex flex-wrap items-end justify-between gap-4"><div><h1 className="break-words font-display text-5xl">{group.name}</h1><p className="mt-3 text-ink/65">{members.length} {members.length === 1 ? 'member' : 'members'} · {trips.length} {trips.length === 1 ? 'trip' : 'trips'} · Private to your group</p></div><Button onClick={() => setShowForm(!showForm)} aria-expanded={showForm} aria-controls="create-trip">{showForm ? 'Close form' : 'Create a trip'}</Button></div>
    {showForm && <Card id="create-trip" className="mt-6 p-5"><h2 className="font-display text-2xl">A new adventure</h2><form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
      <Field label="Trip title" required maxLength={120} value={values.title} onChange={e => setValues({ ...values, title: e.target.value })} disabled={busy} />
      <Field label="Description (optional)" maxLength={2000} value={values.description} onChange={e => setValues({ ...values, description: e.target.value })} disabled={busy} />
      <Field label="Start date (optional)" type="date" value={values.starts_on} onChange={e => setValues({ ...values, starts_on: e.target.value })} disabled={busy} />
      <Field label="End date (optional)" type="date" min={values.starts_on || undefined} value={values.ends_on} onChange={e => setValues({ ...values, ends_on: e.target.value })} disabled={busy} />
      {formError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{formError}</p>}<Button className="justify-self-start" disabled={busy || !values.title.trim()}>{busy ? 'Creating…' : 'Create trip'}</Button>
    </form></Card>}
    <div className="mt-8 grid items-start gap-6 lg:grid-cols-[1fr_320px]">
      <section><h2 className="font-display text-2xl">Shared trips</h2>{trips.length === 0 && <Card className="mt-4 p-8"><p>No trips yet. Create your first trip, then fill it with photos.</p></Card>}<div className="mt-4 grid gap-4 sm:grid-cols-2">{trips.map(trip => <Link to={`/trips/${trip.id}`} key={trip.id} className="rounded-2xl focus-visible:ring-2 focus-visible:ring-ember"><Card className="h-full p-5 hover:shadow-md"><p className="text-sm text-ink/60">{trip.starts_on || 'Dates to come'}{trip.ends_on ? ` → ${trip.ends_on}` : ''}</p><h3 className="mt-6 break-words font-display text-2xl">{trip.title}</h3>{trip.description && <p className="mt-2 break-words text-sm text-ink/65">{trip.description}</p>}</Card></Link>)}</div></section>
      <aside className="space-y-4"><Card className="p-5"><h2 className="font-display text-2xl">The people</h2><p className="mt-2 text-sm text-ink/65">Members can view trips and add photos.</p><ul className="mt-4 space-y-3">{members.map(member => <li key={member.user_id} className="flex items-center justify-between gap-2 text-sm"><span className="break-words">{member.profiles?.display_name || 'Traveler'}{member.user_id === user.id ? ' (you)' : ''}</span><span className="rounded-full bg-sand px-2 py-1 text-xs">{member.role}</span></li>)}</ul></Card>
      {group.created_by === user.id && <Card className="p-5"><h2 className="font-display text-2xl">Invite your people</h2><p className="my-3 text-sm text-ink/65">Anyone with your link can sign in and join for seven days. Creating a new link replaces the previous one.</p><div className="flex flex-wrap gap-2"><Button onClick={() => manageInvite(false)} disabled={inviteBusy} size="sm">{inviteBusy ? 'Updating…' : 'Create invite link'}</Button><Button onClick={() => manageInvite(true)} disabled={inviteBusy} variant="outline" size="sm">Revoke link</Button></div>
        {invitation && <div className="mt-4 space-y-3"><Field label="Invitation link" readOnly value={invitation.url} onFocus={e => e.target.select()} /><p className="text-xs text-ink/60">Expires {invitation.expires}</p><Button onClick={copy} variant="outline" size="sm">Copy link</Button></div>}{message && <p role="status" className="mt-3 text-sm">{message}</p>}{inviteError && <p role="alert" className="mt-3 text-sm text-red-700">{inviteError}</p>}
      </Card>}</aside>
    </div>
  </div>;
}
