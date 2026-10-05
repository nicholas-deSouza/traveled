-- Disposable database only. Published fixtures are inserted by the server role.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %', message; end if; end;
$$;
create function pg_temp.reject_location(ids uuid[], lat double precision default 10, lon double precision default 20, trip uuid default '21000000-0000-0000-0000-000000000001') returns void language plpgsql as $$
begin
  begin
    perform public.set_photo_locations(trip, ids, lat, lon);
  exception when raise_exception then return;
  end;
  raise exception 'FAILED: invalid or unauthorized location save succeeded';
end;
$$;
insert into auth.users(id) values
 ('11000000-0000-0000-0000-000000000001'),
 ('11000000-0000-0000-0000-000000000002'),
 ('11000000-0000-0000-0000-000000000003');
insert into public.groups(id, name, created_by) values ('31000000-0000-0000-0000-000000000001', 'Location fixtures', '11000000-0000-0000-0000-000000000001');
insert into public.group_members(group_id, user_id) values ('31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002');
insert into public.trips(id, group_id, title, created_by) values
 ('21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 'Location trip', '11000000-0000-0000-0000-000000000001'),
 ('21000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000001', 'Other trip', '11000000-0000-0000-0000-000000000001');
insert into public.photos(id, trip_id, uploaded_by, storage_path, latitude, longitude) values
 ('41000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'fixture/location-one.webp', null, null),
 ('41000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'fixture/location-two.webp', null, null),
 ('41000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002', 'fixture/location-peer.webp', null, null),
 ('41000000-0000-0000-0000-000000000004', '21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'fixture/location-gps.webp', 48, 2),
 ('41000000-0000-0000-0000-000000000005', '21000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', 'fixture/location-other-trip.webp', null, null);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select pg_temp.reject_location(array['41000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000003']::uuid[]);
select pg_temp.assert((select latitude is null from public.photos where id = '41000000-0000-0000-0000-000000000001'), 'mixed ownership rolls back every update');
select pg_temp.reject_location(array['41000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000004']::uuid[]);
select pg_temp.assert((select latitude is null from public.photos where id = '41000000-0000-0000-0000-000000000001'), 'existing GPS rolls back every update');
select pg_temp.reject_location(array['41000000-0000-0000-0000-000000000005']::uuid[]);
select pg_temp.reject_location(array['41000000-0000-0000-0000-000000000009']::uuid[]);
select pg_temp.reject_location(array[]::uuid[]);
select pg_temp.reject_location(array['41000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000001']::uuid[]);
select pg_temp.reject_location(array[null]::uuid[]);
select pg_temp.reject_location(array['41000000-0000-0000-0000-000000000001']::uuid[], 91, 0);
select pg_temp.reject_location(array['41000000-0000-0000-0000-000000000001']::uuid[], 0, 181);
select pg_temp.reject_location(array['41000000-0000-0000-0000-000000000001']::uuid[], 'NaN', 0);
select pg_temp.reject_location(array['41000000-0000-0000-0000-000000000001']::uuid[], null, 0);
select public.set_photo_locations('21000000-0000-0000-0000-000000000001', array['41000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002']::uuid[], 0, 0);
select pg_temp.assert((select count(*) = 2 from public.photos where latitude = 0 and longitude = 0), 'bulk saves accept zero coordinates');
select public.set_photo_locations('21000000-0000-0000-0000-000000000001', array['41000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000002']::uuid[], 0, 0);
do $$ begin
  begin
    update public.photos set storage_path = 'changed.webp';
    raise exception 'FAILED: client changed photo storage path';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.photos set uploaded_by = '11000000-0000-0000-0000-000000000002';
    raise exception 'FAILED: client changed photo ownership';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
select pg_temp.reject_location(array['41000000-0000-0000-0000-000000000001']::uuid[], 0, 0);
select public.set_photo_locations('21000000-0000-0000-0000-000000000001', array['41000000-0000-0000-0000-000000000003']::uuid[], -90, 180);
select pg_temp.assert((select latitude = -90 and longitude = 180 from public.photos where id = '41000000-0000-0000-0000-000000000003'), 'member assigns their own photo at valid bounds');
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000003', true);
select pg_temp.reject_location(array['41000000-0000-0000-0000-000000000001']::uuid[], 0, 0);
reset role;
delete from public.group_members where group_id = '31000000-0000-0000-0000-000000000001' and user_id = '11000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select pg_temp.reject_location(array['41000000-0000-0000-0000-000000000005']::uuid[], 10, 20, '21000000-0000-0000-0000-000000000002');
reset role;
select pg_temp.assert((select latitude is null from public.photos where id = '41000000-0000-0000-0000-000000000005'), 'revoked uploader cannot assign a location');
select pg_temp.assert(not has_function_privilege('anon', 'public.set_photo_locations(uuid,uuid[],double precision,double precision)', 'execute'), 'anonymous access denied');
select pg_temp.assert((select not prosecdef from pg_proc where oid = 'public.set_photo_locations(uuid,uuid[],double precision,double precision)'::regprocedure), 'RPC executes under caller RLS');
rollback;
