import { useRef, useState } from 'react';
import { Button } from '../ui/button';
import { deletePhoto, errorMessage, PHOTO_PAGE_SIZE, type Photo } from '../../lib/groups';
import { useTripPhotos } from './useTripPhotos';
import { useSession } from '../../lib/useSession';
import { Modal } from '../ui/modal';
import { hasLocation } from '../../lib/photoMetadata';
import { PhotoLocationPicker } from './PhotoLocationPicker';

export function TripPhotos({ tripId, title }: { tripId: string; title: string }) {
  const { user } = useSession();
  const heading = useRef<HTMLHeadingElement>(null);
  const deleting = useRef(false);
  const closePhoto = useRef<HTMLButtonElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const [viewer, setViewer] = useState<{ photo: Photo; label: string } | null>(null);
  const [pending, setPending] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(0);
  const [locationPhotos, setLocationPhotos] = useState<Photo[] | null>(null);
  const dismissalKey = `traveled:location-later:${user.id}:${tripId}`;
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { const ids: unknown = JSON.parse(sessionStorage.getItem(dismissalKey) || '[]'); return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []; }
    catch { return []; }
  });
  const { data, loading, refreshing, error, reload, removeLocal, locateLocal } = useTripPhotos(tripId, page);
  const unavailable = data?.photos.some(photo => !photo.url);
  const unlocated = data?.photos.filter(photo => photo.uploaded_by === user.id && !hasLocation(photo)) ?? [];
  const suggested = unlocated.filter(photo => !dismissed.includes(photo.id));
  function later(ids: string[]) {
    const next = [...new Set([...dismissed, ...ids])];
    setDismissed(next);
    try { sessionStorage.setItem(dismissalKey, JSON.stringify(next)); } catch { /* Dismissal works even when browser storage is unavailable. */ }
  }

  function confirm(photo: Photo) {
    setDeleteError(''); setMessage(''); setPending(photo);
  }
  async function remove() {
    if (!pending || deleting.current || refreshing) return;
    deleting.current = true; setBusy(true); setDeleteError('');
    try {
      await deletePhoto(pending.id);
      setPending(null); setViewer(null); setMessage('Photo deleted.');
      removeLocal(pending.id);
      if (page > 0 && data?.photos.length === 1) setPage(value => value - 1);
      else reload();
      requestAnimationFrame(() => heading.current?.focus());
    } catch (error) { setDeleteError(errorMessage(error)); }
    finally { deleting.current = false; setBusy(false); }
  }

  return <section className="mt-8" aria-labelledby="trip-moments-heading">
    <h2 ref={heading} tabIndex={-1} id="trip-moments-heading" className="font-display text-2xl">Moments</h2>
    <p role="status" className="mt-2 text-sm">{message}</p>
    {loading && <p className="mt-4 text-ink/65" role="status">Loading photos…</p>}
    {error && <div className="mt-4"><p role="alert">Photos could not be loaded. {error}</p><Button className="mt-2" variant="outline" onClick={reload}>Retry photos</Button></div>}
    {unavailable && <div className="mt-4"><p className="text-sm text-ink/65" role="status">Some photos are unavailable. The other memories are still here.</p><Button className="mt-2" variant="outline" onClick={reload}>Retry unavailable photos</Button></div>}
    {data?.photos.length === 0 && <p className="mt-4 text-ink/65">{page === 0 ? 'Your first memory belongs here. Add photos from this trip.' : 'No photos on this page. Go back to see earlier photos.'}</p>}
    {suggested.length > 0 && <div className="mt-4 rounded-xl bg-sand p-4">
      <h3 className="font-medium">Where were these photos taken?</h3>
      <p className="mt-1 text-sm text-ink/65">{suggested.length} of your photos on this page {suggested.length === 1 ? 'doesn’t' : 'don’t'} include a location. Add one to place them on your trip map.</p>
      <div className="mt-3 flex gap-2"><Button variant="outline" onClick={() => setLocationPhotos(unlocated)}>Add location</Button><Button variant="ghost" onClick={() => later(suggested.map(photo => photo.id))}>Later</Button></div>
    </div>}
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      {data?.photos.map((photo, index) => {
        const label = `Photo ${page * PHOTO_PAGE_SIZE + index + 1} from ${title}`;
        return <div key={photo.id}>
          {photo.url ? <button type="button" onClick={() => setViewer({ photo, label })} aria-label={`Open ${label}`} className="block w-full overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">
            <img src={photo.url} alt={label} loading="lazy" className="aspect-square w-full object-cover transition hover:scale-105" />
          </button> : <div role="img" aria-label={`${label} is unavailable`} className="flex aspect-square items-center justify-center rounded-2xl bg-sand p-4 text-center text-sm text-ink/65">Photo unavailable</div>}
          {photo.uploaded_by === user.id && <Button variant="ghost" className="mt-1" aria-label={`Delete ${label}`} onClick={() => confirm(photo)}>Delete photo</Button>}
          {photo.uploaded_by === user.id && !hasLocation(photo) && <Button variant="outline" size="sm" className="mt-1" aria-label={`Add location to ${label}`} onClick={() => setLocationPhotos([photo])}>Add location</Button>}
        </div>;
      })}
    </div>
    {(page > 0 || data?.hasMore) && <nav className="mt-4 flex items-center gap-4" aria-label="Photo pages">
      <Button variant="outline" disabled={page === 0 || loading || busy} onClick={() => setPage(value => value - 1)}>Previous photos</Button>
      <span className="text-sm" aria-live="polite">Page {page + 1}</span>
      <Button variant="outline" disabled={!data?.hasMore || loading || busy} onClick={() => setPage(value => value + 1)}>Next photos</Button>
    </nav>}
    {locationPhotos && <PhotoLocationPicker tripId={tripId} photos={locationPhotos} onClose={() => {
      later(locationPhotos.map(photo => photo.id)); setLocationPhotos(null);
    }} onSaved={(ids, location) => {
      locateLocal(ids, location); setLocationPhotos(null);
      setMessage(`Location added to ${ids.length} ${ids.length === 1 ? 'photo' : 'photos'}.`);
    }} />}
    {viewer && <Modal initialFocusRef={closePhoto} label={viewer.label} onClose={() => setViewer(null)}>
      <div onClick={event => { if (event.target === event.currentTarget) setViewer(null); }} className="flex max-w-[calc(100vw-2rem)] flex-col items-center gap-3 text-white">
        <div onClick={event => { if (event.target === event.currentTarget) setViewer(null); }} className="flex w-full justify-end gap-3">
          {viewer.photo.uploaded_by === user.id && <Button variant="outline" className="bg-white text-ink" onClick={() => confirm(viewer.photo)}>Delete photo</Button>}
          <Button ref={closePhoto} onClick={() => setViewer(null)}>Close photo</Button>
        </div>
        <img src={viewer.photo.url!} alt={viewer.label} className="max-h-[calc(100dvh-8rem)] max-w-full object-contain" />
      </div>
    </Modal>}
    {pending && <Modal initialFocusRef={cancelDelete} label="Delete this photo?" busy={busy} onClose={() => setPending(null)}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-ink">
        <h3 className="font-display text-2xl">Delete this photo?</h3>
        <p className="mt-2">This cannot be undone.</p>
        {deleteError && <p className="mt-3 text-red-700" role="alert">{deleteError}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="outline" ref={cancelDelete} disabled={busy} onClick={() => setPending(null)}>Cancel</Button>
          <Button disabled={busy || refreshing} onClick={remove}>{busy ? 'Deleting…' : 'Delete'}</Button>
        </div>
      </div>
    </Modal>}
  </section>;
}
