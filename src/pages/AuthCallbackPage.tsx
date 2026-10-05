import { Navigate, useSearchParams } from 'react-router-dom';
import { authDestination } from '../lib/authRedirect';
import { pendingInvitation } from '../lib/pendingInvitation';
import { useSession } from '../lib/useSession';

export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const { user } = useSession();
  const destination = params.get('nextUser') && params.get('nextUser') !== user.id
    ? '/' : authDestination(params.get('next') || pendingInvitation());
  const next = params.get('intent') === 'password' && !destination.startsWith('/account/password')
    ? `/account/password?next=${encodeURIComponent(destination)}`
    : destination;
  return <Navigate to={next} replace />;
}
