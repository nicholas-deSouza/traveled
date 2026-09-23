import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { TravelGlobe } from '../components/maps/TravelGlobe';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { loadAtlas, type Atlas } from '../lib/groups';
import { hasLocation } from '../lib/photoMetadata';
import { tripColor } from '../lib/tripColor';
import { useResource } from '../lib/useResource';
import { useSession } from '../lib/useSession';

const emptyTrips: Atlas['trips'] = [];
const emptyPhotos: Atlas['photos'] = [];

export function DashboardPage() {
  const { user } = useSession();
  const { data, loading, error, reload } = useResource(user.id, loadAtlas);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, 100);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [reload]);
  const trips = data?.trips ?? emptyTrips;
  const photos = data?.photos ?? emptyPhotos;
  return (
    <div className="py-5 md:py-8">
      <section className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="mb-1 text-sm font-medium uppercase tracking-[0.18em] text-ember">The shared atlas</p><h1 className="font-display text-4xl leading-none md:text-6xl">Where we’ve<br />been together.</h1></div>
        <p className="max-w-xs text-sm leading-6 text-ink/65">Explore your trips and shared memories. Photos with GPS locations appear on the globe.</p>
      </section>
      {loading && <p role="status" className="mb-4">Loading your atlas…</p>}
      {error && <div className="mb-4"><p role="alert">Your atlas could not be loaded. {error}</p><Button variant="outline" onClick={reload}>Retry atlas</Button></div>}
      <section className="relative">
        <TravelGlobe trips={trips} photos={photos} />
        {data && <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-3xl bg-gradient-to-t from-ink/60 to-transparent p-5 text-white"><p className="font-display text-2xl">{trips.length} trips · {photos.length} moments</p></div>}
      </section>
      {data && !photos.some(hasLocation) && <p className="mt-3 text-sm text-ink/65">No photos with GPS locations yet. All your trips are listed below.</p>}
      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between"><h2 className="font-display text-2xl">Your trips</h2><Link className="text-sm text-moss hover:underline" to="/groups">Your groups</Link></div>
        {data && trips.length === 0 && <p>Join or create a group to start your shared atlas.</p>}
        <div className="grid gap-3 md:grid-cols-3">{trips.map(trip => <Card key={trip.id} className="p-4">
          <div className="mb-10 flex items-center gap-2"><span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ backgroundColor: tripColor(trip) }} /><span className="rounded-full bg-sand px-2.5 py-1 text-xs font-medium">{trip.photoCount} photos</span></div>
          <h3 className="font-display text-2xl"><Link className="rounded hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember" to={`/trips/${trip.id}`}>{trip.title}</Link></h3>
          <p className="mt-1 text-sm text-ink/60">{trip.groupName}</p>
          {trip.starts_on && <p className="mt-1 text-sm text-ink/60">{trip.starts_on}{trip.ends_on ? ` – ${trip.ends_on}` : ''}</p>}
        </Card>)}</div>
      </section>
    </div>
  );
}
