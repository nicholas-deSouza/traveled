const key = 'traveled:pending-invitation';
const maxAge = 7 * 24 * 60 * 60 * 1000;

function invitationToken(path: string) {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin || url.pathname !== '/join') return null;
  const token = new URLSearchParams(url.hash.slice(1)).get('token');
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

// Email verification may open in a new tab or return without the callback's next
// parameter. Keep only the invitation, never an arbitrary redirect or auth token.
export function rememberInvitation(path: string) {
  try {
    const token = invitationToken(path);
    if (token) {
      if (pendingInvitation() === `/join#token=${token}`) return;
      window.localStorage.setItem(key, JSON.stringify({ token, savedAt: Date.now() }));
    }
  } catch { /* The URL still carries the invitation when storage is unavailable. */ }
}

export function pendingInvitation(): string | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || 'null');
    if (!value || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)
      || typeof value.savedAt !== 'number' || value.savedAt > Date.now() || Date.now() - value.savedAt >= maxAge) return null;
    return `/join#token=${value.token}`;
  } catch { return null; }
}

export function bindInvitation(userId: string) {
  try {
    if (!pendingInvitation()) return;
    const value = JSON.parse(window.localStorage.getItem(key)!);
    if (value.userId && value.userId !== userId) { forgetInvitation(); return; }
    window.localStorage.setItem(key, JSON.stringify({ ...value, userId }));
  } catch { /* Authentication must work without browser storage. */ }
}

export function forgetInvitation(token?: string) {
  try {
    if (!token || pendingInvitation() === `/join#token=${token}`) window.localStorage.removeItem(key);
  } catch { /* Joining must work when browser storage is unavailable. */ }
}
