-- Shared colors inherit the existing member-creator UPDATE policy on trips.
alter table public.trips add column color text;
alter table public.trips add constraint valid_trip_color
  check (color is null or color ~ '^#[0-9A-Fa-f]{6}$');
