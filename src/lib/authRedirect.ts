// Only return to known app destinations, including invitations with fragment tokens.
export function authDestination(path: string | null) {
  try {
    const target = new URL(path || '/groups', window.location.origin);
    if (target.origin === window.location.origin && (target.pathname === '/join' || target.pathname === '/groups' || target.pathname === '/account/password' || /^\/(groups|trips)\/[a-f0-9-]+$/.test(target.pathname))) {
      return target.pathname + target.search + target.hash;
    }
  } catch { /* Invalid destinations return to the user's groups. */ }
  return '/groups';
}
