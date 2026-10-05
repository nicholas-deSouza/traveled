-- Location assignment happens after publication; it never touches the upload queue or Storage.
-- Only coordinates are writable. Keep photo identity, ownership and publication immutable.
revoke update on public.photos from authenticated;
grant update (latitude, longitude) on public.photos to authenticated;

create policy "member uploaders locate their photos" on public.photos
for update to authenticated
using (
  uploaded_by = (select auth.uid())
  and (latitude is null or longitude is null)
  and exists (select 1 from public.trips t where t.id = photos.trip_id and public.is_group_member(t.group_id))
)
with check (
  uploaded_by = (select auth.uid())
  and latitude is not null and latitude between -90 and 90
  and longitude is not null and longitude between -180 and 180
  and exists (select 1 from public.trips t where t.id = photos.trip_id and public.is_group_member(t.group_id))
);

create function public.set_photo_locations(
  target_trip_id uuid, photo_ids uuid[], location_latitude double precision, location_longitude double precision
) returns void language plpgsql security invoker set search_path = '' as $$
declare matched integer;
begin
  if auth.uid() is null then raise exception 'Sign in to add photo locations'; end if;
  if target_trip_id is null or photo_ids is null or cardinality(photo_ids) not between 1 and 100
    or array_position(photo_ids, null) is not null
    or (select count(distinct id) from unnest(photo_ids) as ids(id)) <> cardinality(photo_ids) then
    raise exception 'Select between 1 and 100 distinct photos';
  end if;
  if location_latitude is null or location_longitude is null
    or not (location_latitude between -90 and 90 and location_longitude between -180 and 180) then
    raise exception 'Choose a valid photo location';
  end if;
  update public.photos set latitude = location_latitude, longitude = location_longitude
    where id = any(photo_ids) and trip_id = target_trip_id and uploaded_by = auth.uid()
      and (latitude is null or longitude is null);
  -- Confirm every requested row under SELECT RLS. A mixed or stale selection
  -- raises and rolls back the entire operation, rather than saving a subset.
  -- Identical retries succeed after a lost response without rewriting GPS data.
  select count(*) into matched from public.photos
    where id = any(photo_ids) and trip_id = target_trip_id and uploaded_by = auth.uid()
      and latitude = location_latitude and longitude = location_longitude;
  if matched <> cardinality(photo_ids) then
    raise exception 'Some photos are unavailable or already have a different location. Refresh your photos and try again';
  end if;
end;
$$;
revoke all on function public.set_photo_locations(uuid, uuid[], double precision, double precision) from public, anon;
grant execute on function public.set_photo_locations(uuid, uuid[], double precision, double precision) to authenticated;
