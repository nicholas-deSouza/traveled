import { supabase } from './supabase';
import type { Coordinates } from './photoMetadata';

export type Group = { id: string; name: string; created_by: string };
export type Trip = { id: string; group_id: string; created_by: string; color: string | null; title: string; description: string | null; starts_on: string | null; ends_on: string | null };
export type Member = { user_id: string; role: 'owner' | 'member'; profiles: { display_name: string | null } | null };
export type PhotoMetadata = Coordinates & { id: string; trip_id: string; storage_path: string; uploaded_by: string };
export type Photo = PhotoMetadata & { url: string | null };
export type AtlasTrip = Trip & { groupName: string; photoCount: number };
export type Atlas = { trips: AtlasTrip[]; photos: PhotoMetadata[] };

function client() {
  if (!supabase) throw new Error('Connect Supabase to use groups.');
  return supabase;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message :
    typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : 'Something went wrong. Please try again.';
}

export async function listGroups(): Promise<Group[]> {
  const { data, error } = await client().from('groups').select('id, name, created_by').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createGroup(name: string): Promise<string> {
  const { data, error } = await client().rpc('create_group', { group_name: name });
  if (error) throw error;
  return data;
}

export async function loadGroup(id: string) {
  const db = client();
  const [group, trips, members] = await Promise.all([
    db.from('groups').select('id, name, created_by').eq('id', id).single(),
    db.from('trips').select('*').eq('group_id', id).order('created_at', { ascending: false }),
    db.from('group_members').select('user_id, role, profiles(display_name)').eq('group_id', id).order('created_at'),
  ]);
  if (group.error) throw new Error('This group is unavailable. You must be a member to open it.');
  if (trips.error) throw trips.error;
  if (members.error) throw members.error;
  return { group: group.data as Group, trips: trips.data as Trip[], members: members.data as unknown as Member[] };
}

export async function createTrip(groupId: string, userId: string, values: { title: string; description: string; starts_on: string; ends_on: string }): Promise<string> {
  const { data, error } = await client().from('trips').insert({
    group_id: groupId, created_by: userId, title: values.title.trim(),
    description: values.description.trim() || null, starts_on: values.starts_on || null, ends_on: values.ends_on || null,
  }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function createInvitation(groupId: string): Promise<{ token: string; expires_at: string }> {
  const { data, error } = await client().rpc('create_group_invitation', { target_group_id: groupId });
  if (error) throw error;
  return data[0];
}

export async function revokeInvitation(groupId: string) {
  const { error } = await client().rpc('revoke_group_invitation', { target_group_id: groupId });
  if (error) throw error;
}

export async function acceptInvitation(token: string): Promise<string> {
  const { data, error } = await client().rpc('accept_group_invitation', { invitation_token: token });
  if (error) throw error;
  return data;
}

export async function loadTrip(id: string) {
  const db = client();
  const { data: trip, error } = await db.from('trips').select('*').eq('id', id).single();
  if (error) throw new Error('This trip is unavailable. You must belong to its group to open it.');
  const { data: group, error: groupError } = await db.from('groups').select('id, name, created_by').eq('id', trip.group_id).single();
  if (groupError) throw groupError;
  return { trip: trip as Trip, group: group as Group };
}

export const PHOTO_PAGE_SIZE = 8;

export async function loadTripPhotos(id: string, page = 0, previousPhotos: readonly Photo[] = []) {
  if (!Number.isSafeInteger(page) || page < 0) throw new Error('Invalid photo page.');
  const db = client();
  const start = page * PHOTO_PAGE_SIZE;
  // One extra metadata row indicates a next page without downloading that photo.
  const { data: rows, error } = await db.from('photos')
    .select('id, trip_id, storage_path, uploaded_by, latitude, longitude').eq('trip_id', id)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(start, start + PHOTO_PAGE_SIZE);
  if (error) throw error;
  // Revalidate page metadata under RLS before reusing mounted-gallery blob URLs.
  // Download only new or unavailable images, concurrently; never cache signed URLs.
  const photos: Photo[] = await Promise.all(rows.slice(0, PHOTO_PAGE_SIZE).map(async row => {
    const cached = previousPhotos.find(photo => photo.id === row.id && photo.storage_path === row.storage_path && photo.uploaded_by === row.uploaded_by && photo.url);
    if (cached) return { ...row, url: cached.url };
    try {
      const { data, error: downloadError } = await db.storage.from('trip-photos').download(row.storage_path);
      if (downloadError || !data) return { ...row, url: null };
      return { ...row, url: URL.createObjectURL(data) };
    } catch {
      // Stale metadata or an individual network failure must not hide the trip.
      return { ...row, url: null };
    }
  }));
  return { photos, hasMore: rows.length > PHOTO_PAGE_SIZE };
}

export function releasePhotos(photos: Photo[]) {
  photos.forEach(photo => { if (photo.url) URL.revokeObjectURL(photo.url); });
}

export async function deletePhoto(photoId: string): Promise<void> {
  // The trusted API derives ownership and the Storage path from server metadata.
  // Visibility is removed transactionally before durable byte cleanup.
  const { data, error } = await client().functions.invoke('photo-upload', { body: { action: 'delete', id: photoId } });
  if (error) throw error;
  if (data?.error) throw new Error(String(data.error));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('traveled:photo-changed'));
}

// Metadata only: never download the entire atlas's original images.
async function allRows<T>(table: string, columns: string): Promise<T[]> {
  const rows: T[] = [];
  const size = 500;
  for (let start = 0; ; start += size) {
    const { data, error } = await client().from(table).select(columns)
      .order('id').range(start, start + size - 1);
    if (error) throw error;
    rows.push(...data as T[]);
    if (data.length < size) return rows;
  }
}

export async function loadAtlas(): Promise<Atlas> {
  const [trips, groups, photos] = await Promise.all([
    allRows<Trip & { created_at: string }>('trips', 'id, group_id, created_by, color, title, description, starts_on, ends_on, created_at'),
    allRows<Group>('groups', 'id, name, created_by'),
    allRows<PhotoMetadata>('photos', 'id, trip_id, storage_path, uploaded_by, latitude, longitude'),
  ]);
  const groupNames = new Map(groups.map(group => [group.id, group.name]));
  const visibleTrips = trips.filter(trip => groupNames.has(trip.group_id));
  const ids = new Set(visibleTrips.map(trip => trip.id));
  const visiblePhotos = photos.filter(photo => ids.has(photo.trip_id));
  const counts = new Map<string, number>();
  visiblePhotos.forEach(photo => counts.set(photo.trip_id, (counts.get(photo.trip_id) ?? 0) + 1));
  return {
    trips: visibleTrips.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
      .map(trip => ({ ...trip, groupName: groupNames.get(trip.group_id)!, photoCount: counts.get(trip.id) ?? 0 })),
    photos: visiblePhotos,
  };
}

export async function updateTripColor(tripId: string, color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Choose a valid six-digit color.');
  const { data, error } = await client().from('trips').update({ color }).eq('id', tripId).select('id').single();
  if (error || !data) throw error ?? new Error('This trip could not be updated.');
}

export async function downloadPhoto(path: string): Promise<Blob> {
  const { data, error } = await client().storage.from('trip-photos').download(path);
  if (error || !data) throw error ?? new Error('Photo unavailable.');
  return data;
}
