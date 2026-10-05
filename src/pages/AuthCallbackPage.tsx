import { Navigate, useSearchParams } from 'react-router-dom';
import { authDestination } from '../lib/authRedirect';
import { pendingInvitation } from '../lib/pendingInvitation';

export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const destination = authDestination(params.get('next') || pendingInvitation());
  const next = params.get('intent') === 'password' && !destination.startsWith('/account/password')
    ? `/account/password?next=${encodeURIComponent(destination)}`
    : destination;
  return <Navigate to={next} replace />;
}
