import { useEffect, useState, type ReactNode } from 'react';
import { createUploadManager } from '../../lib/uploads/manager';
import { UploadManagerContext } from '../../lib/useUploadManager';
import { notifyPhotoChanged } from '../../lib/photoChanges';
import { PhotoUploadQueue } from './PhotoUploadQueue';

export function PhotoUploadProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [manager] = useState(() => createUploadManager(userId));
  useEffect(() => {
    manager.start();
    const outcomes = new Map<string, string | null>();
    for (const item of manager.getSnapshot().items) outcomes.set(item.id, item.outcome);
    const unsubscribe = manager.subscribe(() => {
      for (const item of manager.getSnapshot().items) {
        const previous = outcomes.get(item.id);
        if (previous !== item.outcome && (item.outcome === 'published' || item.outcome === 'deleted')) notifyPhotoChanged(item.trip_id);
        outcomes.set(item.id, item.outcome);
      }
    });
    return () => { unsubscribe(); manager.stop(); };
  }, [manager]);
  return <UploadManagerContext.Provider value={manager}>{children}<PhotoUploadQueue /></UploadManagerContext.Provider>;
}
