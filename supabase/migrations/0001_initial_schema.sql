-- Run this migration in a new Supabase project before connecting the UI.
create extension if not exists "pgcrypto";

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text,
  starts_on date,
  ends_on date,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint valid_trip_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null unique,
  taken_at timestamptz,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  created_at timestamptz not null default now()
);

create index trips_group_id_idx on public.trips(group_id);
create index photos_trip_id_idx on public.photos(trip_id);
create index photos_coordinates_idx on public.photos(latitude, longitude) where latitude is not null and longitude is not null;

-- Keep profiles and group ownership in sync with authenticated users.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', 'Traveler'));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.add_group_creator()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.group_members (group_id, user_id, role) values (new.id, new.created_by, 'owner');
  return new;
end;
$$;
create trigger on_group_created after insert on public.groups for each row execute procedure public.add_group_creator();

-- Security-definer helper prevents recursive RLS checks on group_members.
create or replace function public.is_group_member(target_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = target_group_id and user_id = auth.uid());
$$;

create or replace function public.is_group_owner(target_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups where id = target_group_id and created_by = auth.uid());
$$;

create or replace function public.prevent_trip_access_boundary_changes()
returns trigger language plpgsql as $$
begin
  if new.group_id is distinct from old.group_id or new.created_by is distinct from old.created_by then
    raise exception 'A trip cannot be transferred to another group or creator';
  end if;
  return new;
end;
$$;
create trigger prevent_trip_access_boundary_changes before update on public.trips
for each row execute procedure public.prevent_trip_access_boundary_changes();

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.trips enable row level security;
alter table public.photos enable row level security;

create policy "profiles are readable by signed-in users" on public.profiles for select to authenticated using (true);
create policy "users update their own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "users create their own profile" on public.profiles for insert to authenticated with check (id = auth.uid());

create policy "members read their groups" on public.groups for select to authenticated using (public.is_group_member(id));
create policy "users create groups" on public.groups for insert to authenticated with check (created_by = auth.uid());
create policy "owners update groups" on public.groups for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "members read memberships" on public.group_members for select to authenticated using (public.is_group_member(group_id));
create policy "owners add group members" on public.group_members for insert to authenticated with check (public.is_group_owner(group_id) and role = 'member');
create policy "owners remove members" on public.group_members for delete to authenticated using (exists (select 1 from public.groups where id = group_id and created_by = auth.uid()));

create policy "members read trips" on public.trips for select to authenticated using (public.is_group_member(group_id));
create policy "members create trips" on public.trips for insert to authenticated with check (public.is_group_member(group_id) and created_by = auth.uid());
create policy "trip creators update trips" on public.trips for update to authenticated using (created_by = auth.uid()) with check (public.is_group_member(group_id));
create policy "trip creators delete trips" on public.trips for delete to authenticated using (created_by = auth.uid());

create policy "members read photos" on public.photos for select to authenticated using (exists (select 1 from public.trips where trips.id = photos.trip_id and public.is_group_member(trips.group_id)));
create policy "members add photos" on public.photos for insert to authenticated with check (uploaded_by = auth.uid() and exists (select 1 from public.trips where trips.id = photos.trip_id and public.is_group_member(trips.group_id)));
create policy "uploaders delete their photos" on public.photos for delete to authenticated using (uploaded_by = auth.uid());

insert into storage.buckets (id, name, public) values ('trip-photos', 'trip-photos', false) on conflict (id) do nothing;
create policy "group members read photo files" on storage.objects for select to authenticated using (bucket_id = 'trip-photos' and public.is_group_member((storage.foldername(name))[1]::uuid));
create policy "group members upload photo files" on storage.objects for insert to authenticated with check (bucket_id = 'trip-photos' and public.is_group_member((storage.foldername(name))[1]::uuid));
create policy "uploaders delete photo files" on storage.objects for delete to authenticated using (bucket_id = 'trip-photos' and owner_id = auth.uid());
