import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useUploadManager } from '../../lib/useUploadManager';
import { errorMessage } from '../../lib/groups';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

const stages = {
  original_upload: 'Transferring original', original_check: 'Awaiting original verification',
  gps: 'Saving photo location', processing: 'Optimizing photo', candidate_upload: 'Transferring optimized photo',
  candidate_check: 'Awaiting final verification', publication: 'Adding to gallery', complete: 'Complete',
};
const outcomes = {
  published: 'Added to gallery', rejected: 'Not added: did not pass verification', invalid: 'Not added: unsupported image',
  canceled: 'Canceled', expired: 'Expired', deleted: 'Deleted', access_revoked: 'Trip access unavailable',
};
export function PhotoUploadQueue() {
  const manager = useUploadManager();
  const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const visibleItems = snapshot.items.filter(item => !item.outcome || !['published', 'canceled', 'deleted'].includes(item.outcome));
  const unfinished = snapshot.items.filter(item => !item.outcome);
  const failed = unfinished.filter(item => item.local_status === 'failed' || item.pause_reason === 'technical');
  useEffect(() => {
    if (!visibleItems.length && error) setError('');
  }, [visibleItems.length, error]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  const actionError = visibleItems.length ? error : '';
  if (!visibleItems.length && !snapshot.error && snapshot.compatible) return null;
  return <Card className="my-6 p-5" aria-labelledby="photo-upload-heading">
    <h2 id="photo-upload-heading" className="font-display text-2xl">Photo uploads</h2>
    {!snapshot.compatible && <p role="alert" className="mt-2">This browser cannot safely coordinate photo uploads. Use a browser with Web Locks, BroadcastChannel, IndexedDB, and worker WebP encoding.</p>}
    {(actionError || snapshot.error) && <p role="alert" className="mt-2 text-red-700">{actionError || snapshot.error}</p>}
    {visibleItems.length > 0 && <>
      <p role="status" className="mt-2 text-sm">{unfinished.length} awaiting completion. Photos appear after both verification checks.</p>
      <div className="my-3 flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || !failed.length} onClick={() => void run(() => Promise.all(failed.map(item => manager.retry(item.id))))}>Retry failed</Button>
        <Button variant="outline" disabled={busy || !unfinished.length} onClick={() => void run(() => Promise.all(unfinished.map(item => manager.cancel(item.id))))}>Cancel remaining</Button>
      </div>
      <ul className="max-h-80 space-y-3 overflow-y-auto">
        {visibleItems.map(item => <li key={item.id} className="rounded-xl bg-sand/60 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="break-all text-sm font-medium">{item.filename || 'Photo'}{item.trip_id !== '00000000-0000-0000-0000-000000000000' && <> · <Link to={`/trips/${encodeURIComponent(item.trip_id)}`} className="underline">Open trip</Link></>}</p>
            {!item.outcome && <Button size="sm" variant="ghost" disabled={busy} aria-label={`Cancel ${item.filename || 'photo'}`} onClick={() => void run(() => manager.cancel(item.id))}>Cancel</Button>}
          </div>
          <p className="mt-1 text-sm" aria-live="polite" aria-atomic="true">{item.outcome ? outcomes[item.outcome] : item.local_status === 'needs_file' ? 'Reselect the same original photo to continue' : item.local_status === 'failed' ? 'Technical failure: retry available' : item.pause_reason === 'quota' ? 'Paused until the verification allowance resets' : item.pause_reason === 'capacity' ? 'Paused: Storage capacity unavailable' : item.retry_at ? `Retry scheduled for ${new Date(item.retry_at).toLocaleTimeString()}` : stages[item.phase]}</p>
          {(item.local_error || item.error) && <p className="mt-1 text-sm text-red-700">{item.local_error || item.error}</p>}
          {item.local_warning && <p className="mt-1 text-sm text-ink/70">{item.local_warning}</p>}
          {!item.outcome && item.local_status === 'needs_file' && <label className="mt-2 block text-sm">Reselect {item.filename || 'photo'}<input className="mt-1 block max-w-full" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void run(() => manager.reselect(item.id, file)); event.target.value = ''; }} /></label>}
          {!item.outcome && (item.local_status === 'failed' || item.pause_reason === 'technical') && <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => void run(() => manager.retry(item.id))}>Retry {item.filename || 'photo'}</Button>}
        </li>)}
      </ul>
    </>}
  </Card>;
}
