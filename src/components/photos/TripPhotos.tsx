import { useState } from 'react';
import { Button } from '../ui/button';
import { loadTripPhotos, PHOTO_PAGE_SIZE, releasePhotos } from '../../lib/groups';
import { useResource } from '../../lib/useResource';

function loadPage(key: string) {
  const [tripId, page] = JSON.parse(key) as [string, number];
  return loadTripPhotos(tripId, page);
}

function disposePage(data: Awaited<ReturnType<typeof loadTripPhotos>>) {
  releasePhotos(data.photos);
}

export function TripPhotos({ tripId, title }: { tripId: string; title: string }) {
  const [page, setPage] = useState(0);
  const { data, loading, error, reload } = useResource(JSON.stringify([tripId, page]), loadPage, disposePage);
  const unavailable = data?.photos.some(photo => !photo.url);

  return <section className="mt-8" aria-labelledby="trip-moments-heading">
    <h2 id="trip-moments-heading" className="font-display text-2xl">Moments</h2>
    {loading && <p className="mt-4 text-ink/65" role="status">Loading photos…</p>}
    {error && <div className="mt-4"><p role="alert">Photos could not be loaded. {error}</p><Button className="mt-2" variant="outline" onClick={reload}>Retry photos</Button></div>}
    {unavailable && <div className="mt-4"><p className="text-sm text-ink/65" role="status">Some photos are unavailable. The other memories are still here.</p><Button className="mt-2" variant="outline" onClick={reload}>Retry unavailable photos</Button></div>}
    {data?.photos.length === 0 && <p className="mt-4 text-ink/65">{page === 0 ? 'Your first memory belongs here. Add photos from this trip.' : 'No photos on this page. Go back to see earlier photos.'}</p>}
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      {data?.photos.map((photo, index) => {
        const label = `Photo ${page * PHOTO_PAGE_SIZE + index + 1} from ${title}`;
        return photo.url ? <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer" aria-label={`Open ${label}`} className="overflow-hidden rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">
          <img src={photo.url} alt={label} loading="lazy" className="aspect-square w-full object-cover transition hover:scale-105" />
        </a> : <div key={photo.id} role="img" aria-label={`${label} is unavailable`} className="flex aspect-square items-center justify-center rounded-2xl bg-sand p-4 text-center text-sm text-ink/65">Photo unavailable</div>;
      })}
    </div>
    {(page > 0 || data?.hasMore) && <nav className="mt-4 flex items-center gap-4" aria-label="Photo pages">
      <Button variant="outline" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}>Previous photos</Button>
      <span className="text-sm" aria-live="polite">Page {page + 1}</span>
      <Button variant="outline" disabled={!data?.hasMore || loading} onClick={() => setPage(value => value + 1)}>Next photos</Button>
    </nav>}
  </section>;
}
