-- Apply after 0001. Invitations are bearer secrets; only their hashes are stored.
insert into public.profiles (id, display_name)
select id, coalesce(raw_user_meta_data ->> 'display_name', 'Traveler') from auth.users
on conflict (id) do nothing;

create index group_members_user_id_idx on public.group_members(user_id);
create table public.group_invitations (
  group_id uuid primary key references public.groups(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.group_invitations enable row level security;
-- No direct client access: all invitation operations go through the RPCs below.

create function public.create_group(group_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to create a group'; end if;
  if group_name is null or char_length(btrim(group_name)) not between 1 and 80 then
    raise exception 'Group names must contain 1–80 characters';
  end if;
  insert into public.groups (name, created_by) values (btrim(group_name), auth.uid()) returning id into new_id;
  return new_id;
end;
$$;

create function public.create_group_invitation(target_group_id uuid)
returns table (token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare secret text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
declare expiry timestamptz := now() + interval '7 days';
begin
  if not public.is_group_member(target_group_id) or not public.is_group_owner(target_group_id) then
    raise exception 'Only the group owner can manage invitations';
  end if;
  insert into public.group_invitations (group_id, token_hash, expires_at, created_by)
  values (target_group_id, encode(extensions.digest(convert_to(secret, 'UTF8'), 'sha256'), 'hex'), expiry, auth.uid())
  on conflict (group_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at,
    created_by = excluded.created_by, created_at = now();
  return query select secret, expiry;
end;
$$;

create function public.revoke_group_invitation(target_group_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_group_member(target_group_id) or not public.is_group_owner(target_group_id) then
    raise exception 'Only the group owner can manage invitations';
  end if;
  delete from public.group_invitations where group_id = target_group_id;
end;
$$;

create function public.accept_group_invitation(invitation_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare target_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to join this group'; end if;
  if invitation_token is null or invitation_token !~ '^[a-f0-9]{64}$' then
    raise exception 'This invitation is invalid or has expired';
  end if;
  select group_id into target_id from public.group_invitations
    where token_hash = encode(extensions.digest(convert_to(invitation_token, 'UTF8'), 'sha256'), 'hex') and expires_at > now()
    for update;
  if target_id is null then raise exception 'This invitation is invalid or has expired'; end if;
  insert into public.group_members (group_id, user_id) values (target_id, auth.uid()) on conflict do nothing;
  return target_id;
end;
$$;

revoke all on function public.create_group(text) from public, anon;
revoke all on function public.create_group_invitation(uuid) from public, anon;
revoke all on function public.revoke_group_invitation(uuid) from public, anon;
revoke all on function public.accept_group_invitation(text) from public, anon;
grant execute on function public.create_group(text) to authenticated;
grant execute on function public.create_group_invitation(uuid) to authenticated;
grant execute on function public.revoke_group_invitation(uuid) to authenticated;
grant execute on function public.accept_group_invitation(text) to authenticated;

-- Keep owners in their group, and require current membership for every mutation.
drop policy "owners remove members" on public.group_members;
create policy "owners remove other members" on public.group_members for delete to authenticated
  using (public.is_group_member(group_id) and public.is_group_owner(group_id) and role <> 'owner');
drop policy "trip creators update trips" on public.trips;
create policy "member creators update trips" on public.trips for update to authenticated
  using (created_by = auth.uid() and public.is_group_member(group_id))
  with check (created_by = auth.uid() and public.is_group_member(group_id));
drop policy "trip creators delete trips" on public.trips;
create policy "member creators delete trips" on public.trips for delete to authenticated
  using (created_by = auth.uid() and public.is_group_member(group_id));
drop policy "uploaders delete their photos" on public.photos;
create policy "member uploaders delete photos" on public.photos for delete to authenticated
  using (uploaded_by = auth.uid() and exists (
    select 1 from public.trips where id = photos.trip_id and public.is_group_member(group_id)
  ));

-- Compare text rather than casting untrusted paths to UUID. Both group and trip
-- must match, so files cannot be placed in another group's trip directory.
create function public.can_access_trip_photo(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.trips t
    where t.group_id::text = split_part(object_name, '/', 1)
      and t.id::text = split_part(object_name, '/', 2)
      and split_part(object_name, '/', 3) <> ''
      and array_length(string_to_array(object_name, '/'), 1) = 3
      and public.is_group_member(t.group_id)
  );
$$;
revoke all on function public.can_access_trip_photo(text) from public, anon;
grant execute on function public.can_access_trip_photo(text) to authenticated;

drop policy "members add photos" on public.photos;
create policy "members add uploaded photos" on public.photos for insert to authenticated
  with check (uploaded_by = auth.uid() and exists (
    select 1 from public.trips t where t.id = photos.trip_id
      and public.is_group_member(t.group_id)
      and split_part(photos.storage_path, '/', 1) = t.group_id::text
      and split_part(photos.storage_path, '/', 2) = t.id::text
  ) and exists (
    select 1 from storage.objects o where o.bucket_id = 'trip-photos'
      and o.name = photos.storage_path and o.owner_id = auth.uid()::text
  ));

drop policy "group members read photo files" on storage.objects;
drop policy "group members upload photo files" on storage.objects;
drop policy "uploaders delete photo files" on storage.objects;
create policy "members read trip files" on storage.objects for select to authenticated
  using (bucket_id = 'trip-photos' and public.can_access_trip_photo(name));
create policy "members upload trip files" on storage.objects for insert to authenticated
  with check (bucket_id = 'trip-photos' and public.can_access_trip_photo(name));
create policy "member uploaders delete trip files" on storage.objects for delete to authenticated
  using (bucket_id = 'trip-photos' and owner_id = auth.uid()::text and public.can_access_trip_photo(name));
update storage.buckets set public = false, file_size_limit = 20971520,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  where id = 'trip-photos';
