import { Link, useParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { loadTrip } from '../lib/groups';
import { useResource } from '../lib/useResource';
import { useSession } from '../lib/useSession';

import { TripColorPicker } from '../components/photos/TripColorPicker';
import { TripPhotos } from '../components/photos/TripPhotos';
import { PhotoUploadForm } from '../components/photos/PhotoUploadForm';

export function TripDetailPage() {
  const { tripId = '' } = useParams();
  return <TripContent key={tripId} tripId={tripId} />;
}

function TripContent({ tripId }: { tripId: string }) {
  const { user } = useSession();
  const { data, loading, error, reload } = useResource(tripId, loadTrip);
  if (loading) return <p className="py-12" role="status">Loading trip…</p>;
  if (error || !data) return <div className="py-12"><p role="alert">{error}</p><Button onClick={reload} variant="outline" className="mt-4">Retry</Button><Link to="/groups" className="ml-4 underline">Your groups</Link></div>;
  return <div className="py-8"><Link className="text-sm text-moss hover:underline" to={`/groups/${data.group.id}`}>← {data.group.name}</Link><h1 className="mt-4 break-words font-display text-5xl">{data.trip.title}</h1><p className="mt-3 text-ink/65">{data.trip.starts_on || 'No dates set'}{data.trip.ends_on ? ` → ${data.trip.ends_on}` : ''} · Only group members</p>{data.trip.description && <p className="mt-3 break-words">{data.trip.description}</p>}
    <TripColorPicker trip={data.trip} canEdit={data.trip.created_by === user.id} />
    <Card className="mt-8 p-5"><PhotoUploadForm tripId={data.trip.id} /></Card>
    <TripPhotos tripId={tripId} title={data.trip.title} />
  </div>;
}
