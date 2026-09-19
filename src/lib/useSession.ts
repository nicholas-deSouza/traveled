import type { Session } from '@supabase/supabase-js';
import { useOutletContext } from 'react-router-dom';

export function useSession() {
  return useOutletContext<Session>();
}
