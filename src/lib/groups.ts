import { supabase } from './supabase';
import { extractLocation, type Coordinates } from './photoMetadata';

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

export async function loadTripPhotos(id: string, page = 0) {
  if (!Number.isSafeInteger(page) || page < 0) throw new Error('Invalid photo page.');
  const db = client();
  const start = page * PHOTO_PAGE_SIZE;
  // One extra metadata row indicates a next page without downloading that photo.
  const { data: rows, error } = await db.from('photos')
    .select('id, trip_id, storage_path, uploaded_by, latitude, longitude').eq('trip_id', id)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(start, start + PHOTO_PAGE_SIZE);
  if (error) throw error;
  // Only this page is downloaded, concurrently. Each authenticated download
  // checks membership; no reusable signed URLs outlive a membership change.
  const photos: Photo[] = await Promise.all(rows.slice(0, PHOTO_PAGE_SIZE).map(async row => {
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

export async function uploadPhoto(trip: Trip, userId: string, file: File) {
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const extension = extensions[file.type];
  if (!extension || file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: choose a JPEG, PNG, WebP, or GIF under 20 MB.`);
  const db = client();
  const location = await extractLocation(file);
  const path = `${trip.group_id}/${trip.id}/${crypto.randomUUID()}.${extension}`;
  const { error } = await db.storage.from('trip-photos').upload(path, file, { contentType: file.type });
  if (error) throw error;
  const { error: photoError } = await db.from('photos').insert({ trip_id: trip.id, uploaded_by: userId, storage_path: path, ...location });
  if (photoError) {
    const { error: cleanupError } = await db.storage.from('trip-photos').remove([path]);
    if (cleanupError) throw new Error(`${errorMessage(photoError)} The file could not be cleaned up; please contact the group owner.`);
    throw photoError;
  }
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

export async function deletePhoto(photoId: string, userId: string) {
  const db = client();
  // Fetch the canonical path and owner rather than trusting a UI-supplied path.
  const { data: photo, error: readError } = await db.from('photos')
    .select('id, uploaded_by, storage_path').eq('id', photoId).single();
  if (readError || !photo) throw readError ?? new Error('Photo unavailable.');
  if (photo.uploaded_by !== userId) throw new Error('You can only delete your own photos.');
  const { error: storageError } = await db.storage.from('trip-photos').remove([photo.storage_path]);
  // A retry may find that the original object was already removed.
  if (storageError && !('statusCode' in storageError && String(storageError.statusCode) === '404')) throw storageError;
  const { data, error } = await db.from('photos').delete().eq('id', photoId).eq('uploaded_by', userId).select('id');
  if (error || !data?.length) throw new Error('The file was removed, but its photo record could not be deleted. Retry deletion to finish.');
}
