import { supabase } from './supabase';
import { displayName } from './displayName';

export async function saveDisplayName(userId: string, name: string) {
  const validName = displayName(name);
  if (!supabase) throw new Error('Connect Supabase to save your name.');
  const { data, error } = await supabase.from('profiles').update({ display_name: validName }).eq('id', userId).select('id').single();
  if (error || !data) throw error ?? new Error('Your name could not be saved. Please try again.');
}
