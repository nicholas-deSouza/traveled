import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createUploadManager } from '../../lib/uploads/manager';
import { UploadManagerContext, UploadQueuePlacementContext } from '../../lib/useUploadManager';
import { notifyPhotoChanged } from '../../lib/photoChanges';
import { PhotoUploadQueue } from './PhotoUploadQueue';

export function PhotoUploadProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <AccountPhotoUploadProvider key={userId} userId={userId}>{children}</AccountPhotoUploadProvider>;
}

function AccountPhotoUploadProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [manager] = useState(() => createUploadManager(userId));
  const [queueTarget, setQueueTarget] = useState<HTMLDivElement | null>(null);
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
  return <UploadManagerContext.Provider value={manager}>
    <UploadQueuePlacementContext.Provider value={setQueueTarget}>{children}</UploadQueuePlacementContext.Provider>
    {queueTarget ? createPortal(<PhotoUploadQueue />, queueTarget)
      : <div id="photo-upload-progress" tabIndex={-1}><PhotoUploadQueue /></div>}
  </UploadManagerContext.Provider>;
}
