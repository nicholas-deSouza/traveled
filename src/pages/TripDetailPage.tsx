import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { errorMessage, loadTrip, uploadPhoto } from '../lib/groups';
import { useResource } from '../lib/useResource';
import { useSession } from '../lib/useSession';

import { TripPhotos } from '../components/photos/TripPhotos';

export function TripDetailPage() {
  const { tripId = '' } = useParams();
  return <TripContent key={tripId} tripId={tripId} />;
}

function TripContent({ tripId }: { tripId: string }) {
  const { user } = useSession();
  const { data, loading, error, reload } = useResource(tripId, loadTrip);
  const [photoRevision, setPhotoRevision] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [uploadError, setUploadError] = useState('');
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy || files.length === 0) return;
    const form = event.currentTarget;
    setBusy(true); setMessage(''); setUploadError('');
    let count = 0;
    try {
      for (const file of files) {
        setMessage(`Uploading photo ${count + 1} of ${files.length}…`);
        await uploadPhoto(data.trip, user.id, file);
        count++;
      }
      setMessage(`${count} ${count === 1 ? 'photo' : 'photos'} added.`);
    } catch (error) {
      setMessage(count ? `${count} photos added before the upload stopped.` : '');
      setUploadError(errorMessage(error));
    } finally {
      setFiles([]); form.reset(); setBusy(false);
      if (count) setPhotoRevision(value => value + 1);
    }
  }
  if (loading) return <p className="py-12" role="status">Loading trip…</p>;
  if (error || !data) return <div className="py-12"><p role="alert">{error}</p><Button onClick={reload} variant="outline" className="mt-4">Retry</Button><Link to="/groups" className="ml-4 underline">Your groups</Link></div>;
  return <div className="py-8"><Link className="text-sm text-moss hover:underline" to={`/groups/${data.group.id}`}>← {data.group.name}</Link><h1 className="mt-4 break-words font-display text-5xl">{data.trip.title}</h1><p className="mt-3 text-ink/65">{data.trip.starts_on || 'No dates set'}{data.trip.ends_on ? ` → ${data.trip.ends_on}` : ''} · Only group members</p>{data.trip.description && <p className="mt-3 break-words">{data.trip.description}</p>}
    <Card className="mt-8 p-5"><form onSubmit={upload} className="flex flex-wrap items-end gap-4"><label className="block text-sm font-medium">Add photos<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy} onChange={event => setFiles(Array.from(event.target.files ?? []))} className="mt-2 block max-w-full rounded-lg text-sm file:mr-3 file:rounded-full file:border-0 file:bg-sand file:px-4 file:py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember" /><span className="mt-2 block text-xs text-ink/60">JPEG, PNG, WebP, or GIF. Up to 20 MB per photo.</span></label><Button disabled={busy || !files.length}>{busy ? 'Uploading…' : `Upload${files.length ? ` ${files.length} photos` : ' photos'}`}</Button></form></Card>
    {message && <p className="mt-4 text-sm" role="status">{message}</p>}{uploadError && <p className="mt-4 text-sm text-red-700" role="alert">{uploadError}</p>}
    <TripPhotos key={photoRevision} tripId={tripId} title={data.trip.title} />
  </div>;
}
