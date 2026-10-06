import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../../lib/groups';
import { useUploadManager } from '../../lib/useUploadManager';
import { Button } from '../ui/button';

function SelectedPhoto({ file, busy, onRemove }: { file: File; busy: boolean; onRemove(): void }) {
  const { preview: previewPhoto } = useUploadManager();
  const [url, setUrl] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let preview = '';
    setUrl(''); setUnavailable(false);
    async function prepare() {
      try {
        const source = /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type)
          ? await previewPhoto(file, controller.signal) : file;
        if (controller.signal.aborted) return;
        preview = URL.createObjectURL(source);
        setUrl(preview);
      } catch { if (!controller.signal.aborted) setUnavailable(true); }
    }
    void prepare();
    return () => { controller.abort(); if (preview) URL.revokeObjectURL(preview); };
  }, [file, previewPhoto]);
  return <li className="w-28 shrink-0 sm:w-36">
    {unavailable ? <div className="flex aspect-square items-center justify-center rounded-xl bg-sand p-3 text-center text-xs text-ink/65">Preview unavailable</div>
      : url ? <img src={url} alt={`Preview of ${file.name}`} onError={() => setUnavailable(true)} className="aspect-square w-full rounded-xl bg-sand object-cover" />
        : <div role="status" className="flex aspect-square items-center justify-center rounded-xl bg-sand p-3 text-center text-xs text-ink/65">Preparing preview…</div>}
    <p className="mt-2 truncate text-xs text-ink/65" title={file.name}>{file.name}</p>
    <Button type="button" size="sm" variant="ghost" className="mt-1 w-full cursor-pointer" disabled={busy} aria-label={`Remove ${file.name}`} onClick={onRemove}>Remove</Button>
  </li>;
}

export function PhotoUploadForm({ tripId }: { tripId: string }) {
  const uploads = useUploadManager();
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(0);
  const headingId = useId(), helpId = useId();
  const [selection, setSelection] = useState<{ id: number; file: File }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !selection.length) return;
    setBusy(true); setMessage(''); setError('');
    try {
      await uploads.enqueue(tripId, selection.map(({ file }) => file));
      setMessage(`${selection.length} ${selection.length === 1 ? 'photo queued' : 'photos queued'}. Follow progress in Photo uploads.`);
      setSelection([]);
    } catch (cause) { setError(errorMessage(cause)); }
    finally { setBusy(false); }
  }
  return <form onSubmit={upload} aria-labelledby={headingId}>
    <h2 id={headingId} className="text-sm font-medium">Add photos</h2>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <input ref={input} type="file" hidden aria-label="Add photos" aria-describedby={helpId} multiple
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" disabled={busy}
        onChange={event => {
          const added = Array.from(event.target.files ?? []).map(file => ({ id: nextId.current++, file }));
          setSelection(current => {
            // Metadata can match for distinct photos. Only skip the same File object.
            const seen = new Set(current.map(({ file }) => file));
            return [...current, ...added.filter(({ file }) => {
              if (seen.has(file)) return false;
              seen.add(file);
              return true;
            })];
          });
          if (added.length) { setMessage(''); setError(''); }
          event.target.value = '';
        }} />
      <Button type="button" variant="outline" className="cursor-pointer border-0 bg-sand hover:bg-sand/80" disabled={busy}
        aria-describedby={helpId} onClick={() => input.current?.click()}>Choose files</Button>
      <Button type="submit" className="cursor-pointer" disabled={busy || !selection.length}>
        {busy ? 'Queueing…' : selection.length ? `Upload ${selection.length} ${selection.length === 1 ? 'photo' : 'photos'}` : 'Upload photos'}
      </Button>
    </div>
    <p id={helpId} className="mt-3 text-xs text-ink/60">Still JPEG, PNG, WebP, or HEIC. Up to 20 MiB and 50 megapixels per photo.</p>
    {selection.length > 0 && <ul aria-label="Selected photos" className="mt-4 flex gap-4 overflow-x-auto pb-1">
      {selection.map(({ id, file }) => <SelectedPhoto key={id} file={file} busy={busy} onRemove={() => {
        setSelection(current => current.filter(photo => photo.id !== id)); setError('');
      }} />)}
    </ul>}
    {message && <div className="mt-4 text-sm"><p role="status">{message}</p>
      <a href="#photo-upload-progress" className="inline-flex min-h-11 items-center text-moss underline">View upload progress</a>
    </div>}
    {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
  </form>;
}
