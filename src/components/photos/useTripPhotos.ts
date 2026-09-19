import { useEffect, useRef, useState } from 'react';
import { errorMessage, loadTripPhotos, releasePhotos, type Photo } from '../../lib/groups';

type PhotoPage = Awaited<ReturnType<typeof loadTripPhotos>>;

// Blob URLs belong to this mounted gallery, never a global or cross-user cache.
export function useTripPhotos(tripId: string, page: number) {
  const cache = useRef<Photo[]>([]);
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([tripId, page]);
  const [result, setResult] = useState<{ key: string; data?: PhotoPage; error?: string }>();
  const [finished, setFinished] = useState('');
  const requestKey = JSON.stringify([key, revision]);

  useEffect(() => {
    return () => {
      releasePhotos(cache.current);
      cache.current = [];
    };
  }, [tripId]);

  useEffect(() => {
    let active = true;
    const previous = cache.current;
    loadTripPhotos(tripId, page, previous).then(data => {
      if (!active) {
        // Shared URLs still belong to the active gallery (or were already disposed).
        releasePhotos(data.photos.filter(photo => !previous.some(old => old.url === photo.url)));
        return;
      }
      releasePhotos(cache.current.filter(photo => !data.photos.some(next => next.url === photo.url)));
      cache.current = data.photos;
      setResult({ key, data });
      setFinished(requestKey);
    }).catch(error => {
      if (!active) return;
      setResult(old => ({ key, data: old?.key === key ? old.data : undefined, error: errorMessage(error) }));
      setFinished(requestKey);
    });
    return () => { active = false; };
  }, [tripId, page, key, requestKey]);

  function removeLocal(photoId: string) {
    releasePhotos(cache.current.filter(photo => photo.id === photoId));
    cache.current = cache.current.filter(photo => photo.id !== photoId);
    setResult(old => old?.key === key && old.data
      ? { ...old, data: { ...old.data, photos: old.data.photos.filter(photo => photo.id !== photoId) } }
      : old);
  }

  const current = result?.key === key ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: !current && finished !== requestKey,
    refreshing: finished !== requestKey,
    reload: () => setRevision(value => value + 1),
    removeLocal,
  };
}
