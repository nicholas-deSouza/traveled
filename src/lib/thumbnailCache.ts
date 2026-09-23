// Scoped to one map dataset. No private images survive data refresh or unmount.
export function thumbnailCache(download: (path: string) => Promise<Blob>, concurrency = 4) {
  const entries = new Map<string, { url: string | null; ready: boolean }>();
  let wanted = new Map<string, (url: string | null) => void>();
  const pending = new Set<string>();
  let active = 0;
  let disposed = false;
  function pump() {
    if (disposed) return;
    for (const [path, entry] of entries) {
      if (!wanted.has(path)) {
        if (entry.url) URL.revokeObjectURL(entry.url);
        entries.delete(path);
      }
    }
    for (const [path, receive] of wanted) {
      if (entries.get(path)?.ready) { receive(entries.get(path)!.url); continue; }
      if (active >= concurrency || pending.has(path)) continue;
      active++; pending.add(path);
      void download(path).then(blob => {
        if (disposed || !wanted.has(path)) return;
        const url = URL.createObjectURL(blob);
        entries.set(path, { url, ready: true });
        wanted.get(path)?.(url);
      }).catch(() => {
        if (!disposed && wanted.has(path)) { entries.set(path, { url: null, ready: true }); wanted.get(path)?.(null); }
      }).finally(() => { active--; pending.delete(path); pump(); });
    }
  }
  return {
    setVisible(next: Map<string, (url: string | null) => void>) {
      // Keep only current viewport images; never retain an offscreen cache or
      // truncate visible thumbnails when several trips overlap.
      wanted = new Map(next);
      pump();
    },
    dispose() {
      disposed = true; wanted.clear();
      entries.forEach(entry => { if (entry.url) URL.revokeObjectURL(entry.url); });
      entries.clear();
    },
  };
}
