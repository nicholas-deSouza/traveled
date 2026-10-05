import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { updatePhotoLocations, errorMessage, type Photo } from '../../lib/groups';
import { hasLocation } from '../../lib/photoMetadata';
import { searchPlaces, type Place } from '../../lib/placeSearch';
import { PhotoLocationMap, type PhotoLocation } from '../maps/PhotoLocationMap';
import { Button } from '../ui/button';
import { Field } from '../ui/field';
import { Modal } from '../ui/modal';

export function PhotoLocationPicker({ tripId, photos, onClose, onSaved }: {
  tripId: string; photos: Photo[]; onClose(): void; onSaved(ids: string[], location: PhotoLocation): void;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const [selected, setSelected] = useState(() => new Set(photos.map(photo => photo.id)));
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  const location = useMemo(() => {
    const coordinates = { latitude: latitude.trim() ? Number(latitude) : null, longitude: longitude.trim() ? Number(longitude) : null };
    return hasLocation(coordinates) ? coordinates : null;
  }, [latitude, longitude]);
  useEffect(() => () => request.current?.abort(), []);
  function choose(value: PhotoLocation) {
    setLatitude(String(value.latitude)); setLongitude(String(value.longitude)); setSaveError('');
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    if (searching || busy) return;
    const controller = new AbortController();
    request.current?.abort(); request.current = controller;
    setSearching(true); setSearchError(''); setPlaces([]); setSearched(false);
    try { const results = await searchPlaces(query, controller.signal); if (!controller.signal.aborted) { setPlaces(results); setSearched(true); } }
    catch (error) { if (!controller.signal.aborted) setSearchError(errorMessage(error)); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  }
  async function save() {
    if (!location || !selected.size || saving.current) return;
    const ids = [...selected];
    saving.current = true; setBusy(true); setSaveError('');
    try { await updatePhotoLocations(tripId, ids, location); onSaved(ids, location); }
    catch (error) { setSaveError(`Location could not be saved. Your photos are still uploaded. ${errorMessage(error)}`); }
    finally { saving.current = false; setBusy(false); }
  }
  return <Modal label="Add photo location" initialFocusRef={searchInput} busy={busy} onClose={onClose}>
    <div className="w-[calc(100vw-2rem)] max-w-xl rounded-2xl bg-white p-5 text-ink sm:p-6">
      <h3 className="font-display text-2xl">Where were these photos taken?</h3>
      <p className="mt-2 text-sm text-ink/65">Choose photos taken at the same place. Uploads continue while you add a location.</p>
      <fieldset disabled={busy} className="mt-4">
        <legend className="text-sm font-medium">Photos to place</legend>
        <div className="mt-2 flex max-h-40 gap-3 overflow-auto pb-2">
          {photos.map((photo, index) => <label key={photo.id} className="w-24 shrink-0 cursor-pointer text-sm">
            {photo.url ? <img src={photo.url} alt="" className="mb-2 aspect-square w-full rounded-xl object-cover" /> : <span className="mb-2 flex aspect-square items-center rounded-xl bg-sand p-2 text-xs">Preview unavailable</span>}
            <input type="checkbox" className="mr-2 accent-ember" checked={selected.has(photo.id)} onChange={event => {
              const checked = event.target.checked;
              setSelected(current => { const next = new Set(current); if (checked) next.add(photo.id); else next.delete(photo.id); return next; });
            }} />Photo {index + 1}
          </label>)}
        </div>
      </fieldset>
      <form onSubmit={search} className="mt-4">
        <label className="block text-sm font-medium">Search for a place<input ref={searchInput} value={query} maxLength={200} disabled={busy || searching} onChange={event => setQuery(event.target.value)} placeholder="City, landmark, or address" className="mt-2 h-11 w-full rounded-xl border border-ink/15 px-3 focus:outline-none focus:ring-2 focus:ring-ember" /></label>
        <Button type="submit" variant="outline" className="mt-2" disabled={busy || searching || query.trim().length < 2}>{searching ? 'Searching…' : 'Search places'}</Button>
        <p className="mt-2 text-xs text-ink/60">Search by <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>. Only your search text is sent.</p>
      </form>
      {searchError && <p role="alert" className="mt-2 text-sm text-red-700">{searchError}</p>}
      {searched && places.length === 0 && <p role="status" className="mt-2 text-sm">No places found. Try another name or use the map.</p>}
      {places.length > 0 && <ul aria-label="Place results" className="mt-3 max-h-36 overflow-auto space-y-1">{places.map(place => <li key={place.id}><Button variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left" disabled={busy} onClick={() => choose(place)}>{place.name}</Button></li>)}</ul>}
      <div className="mt-4"><PhotoLocationMap location={location} onChange={choose} disabled={busy} /></div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label="Latitude" type="number" min={-90} max={90} step="any" value={latitude} disabled={busy} onChange={event => { setLatitude(event.target.value); setSaveError(''); }} />
        <Field label="Longitude" type="number" min={-180} max={180} step="any" value={longitude} disabled={busy} onChange={event => { setLongitude(event.target.value); setSaveError(''); }} />
      </div>
      <p role="status" className="mt-3 text-sm">{selected.size} {selected.size === 1 ? 'photo selected' : 'photos selected'}{location ? ` · ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : ' · Choose a location to save'}</p>
      {saveError && <p role="alert" className="mt-3 text-sm text-red-700">{saveError}</p>}
      <div className="mt-5 flex justify-end gap-3">
        <Button variant="outline" disabled={busy} onClick={onClose}>Later</Button>
        <Button disabled={busy || !location || !selected.size} onClick={() => void save()}>{busy ? 'Saving…' : 'Save location'}</Button>
      </div>
    </div>
  </Modal>;
}
