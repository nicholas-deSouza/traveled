import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { TravelGlobe } from '../components/maps/TravelGlobe';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { loadAtlas } from '../lib/groups';
import { useResource } from '../lib/useResource';
import { useSession } from '../lib/useSession';
import { tripColor } from '../lib/tripColor';
import { hasLocation } from '../lib/photoMetadata';

const emptyTrips: Awaited<ReturnType<typeof loadAtlas>>['trips'] = [];
const emptyPhotos: Awaited<ReturnType<typeof loadAtlas>>['photos'] = [];
export function DashboardPage() {
  const { user } = useSession();
  const [revision, setRevision] = useState(0);
  const { data, loading, error } = useResource(`${user.id}:${revision}`, loadAtlas);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setRevision(value => value + 1); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  const locatedCount = data?.photos.filter(hasLocation).length ?? 0;
  return <div className="py-5 md:py-8">
    <section className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
      <div><p className="mb-1 text-sm font-medium uppercase tracking-[0.18em] text-ember">The shared atlas</p><h1 className="font-display text-4xl leading-none md:text-6xl">Where we’ve<br />been together.</h1></div>
      <p className="max-w-xs text-sm leading-6 text-ink/65">All your groups, one globe. Zoom in to see photos and open the trip behind each memory.</p>
    </section>
    <TravelGlobe trips={data?.trips ?? emptyTrips} photos={data?.photos ?? emptyPhotos} />
    {loading && <p className="mt-3" role="status">Loading your shared atlas…</p>}
    {error && <div className="mt-3"><p role="alert">Your atlas could not be loaded. {error}</p><Button variant="outline" className="mt-2" onClick={() => setRevision(value => value + 1)}>Retry</Button></div>}
    {data && <p className="mt-3 text-sm text-ink/65">{data.trips.length} trips · {data.photos.length} photos · {locatedCount} on the globe</p>}
    {data && locatedCount === 0 && <p className="mt-2 text-sm text-ink/65">Photos with GPS locations will appear here after uploading. Photos without locations stay in their trip galleries.</p>}
    <section className="mt-8" aria-labelledby="recent-trips"><div className="mb-4 flex items-center justify-between"><h2 id="recent-trips" className="font-display text-2xl">Your trips</h2><Link className="text-sm text-moss underline" to="/groups">Your groups</Link></div>
      {data?.trips.length === 0 && <Card className="p-6">Your atlas starts with a trip. <Link to="/groups" className="underline">Open your groups to create one.</Link></Card>}
      <div className="grid gap-3 md:grid-cols-3">{data?.trips.map(trip => <Link key={trip.id} to={`/trips/${trip.id}`} className="rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"><Card className="h-full border-t-4 p-4 transition hover:-translate-y-0.5 hover:shadow-md" style={{ borderTopColor: tripColor(trip) }}><div className="mb-8 flex items-center justify-between"><span className="rounded-full bg-sand px-2.5 py-1 text-xs font-medium">{trip.photoCount} photos</span><ArrowUpRight aria-hidden="true" className="h-4 w-4 text-ink/45" /></div><p className="mb-1 break-words text-xs text-ink/60">{trip.groupName}</p><h3 className="break-words font-display text-2xl">{trip.title}</h3><p className="mt-1 text-sm text-ink/60">{trip.starts_on || 'Dates to come'}{trip.ends_on ? ` → ${trip.ends_on}` : ''}</p></Card></Link>)}</div>
    </section>
  </div>;
}
