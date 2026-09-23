import { useState, type FormEvent } from 'react';
import { errorMessage, updateTripColor, type Trip } from '../../lib/groups';
import { tripColor } from '../../lib/tripColor';
import { Button } from '../ui/button';

export function TripColorPicker({ trip, canEdit }: { trip: Trip; canEdit: boolean }) {
  const [saved, setSaved] = useState(tripColor(trip));
  const [draft, setDraft] = useState(saved);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { await updateTripColor(trip.id, draft); setSaved(draft); setEditing(false); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="mt-5">
    <div className="flex items-center gap-3"><span aria-hidden="true" className="h-4 w-4 rounded-full border border-ink/20" style={{ background: saved }} /><span className="text-sm">Trip color</span>{canEdit && !editing && <Button variant="outline" size="sm" onClick={() => { setDraft(saved); setEditing(true); }}>Change color</Button>}</div>
    {editing && <form onSubmit={save} className="mt-3 flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-sm">Choose trip color<input type="color" value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} className="h-10 w-14 cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-ember" /></label><Button size="sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>Cancel</Button></form>}
    {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
  </div>;
}
