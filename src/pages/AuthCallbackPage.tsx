import { Navigate, useSearchParams } from 'react-router-dom';

export function AuthCallbackPage() {
  const [params] = useSearchParams();
  let next = '/groups';
  try {
    const target = new URL(params.get('next') || next, window.location.origin);
    if (target.origin === window.location.origin && (target.pathname === '/join' || target.pathname === '/groups' || /^\/(groups|trips)\/[a-f0-9-]+$/.test(target.pathname))) {
      next = target.pathname + target.search + target.hash;
    }
  } catch { /* An invalid redirect returns to the user's groups. */ }
  return <Navigate to={next} replace />;
}
