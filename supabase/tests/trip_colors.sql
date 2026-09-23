-- Run after all migrations in a disposable database; fixtures roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAILED: %', message; end if;
end;
$$;
insert into auth.users(id) values
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select public.create_group('Color fixtures') as group_id \gset
insert into public.trips(group_id, title, created_by)
values (:'group_id', 'Shared color', auth.uid()) returning id as trip_id \gset
select pg_temp.assert((select color is null from public.trips where id = :'trip_id'), 'old/new trips can use fallback color');
update public.trips set color = '#12aB34' where id = :'trip_id';
select pg_temp.assert((select color = '#12aB34' from public.trips where id = :'trip_id'), 'creator saves color');
do $$ begin
  begin
    update public.trips set color = 'red';
    raise exception 'Invalid color was accepted';
  exception when check_violation then null;
  end;
end $$;
reset role;
insert into public.group_members(group_id, user_id, role)
values (:'group_id', '10000000-0000-0000-0000-000000000002', 'member');
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select pg_temp.assert((select color = '#12aB34' from public.trips where id = :'trip_id'), 'member sees shared color');
update public.trips set color = '#FFFFFF' where id = :'trip_id';
select pg_temp.assert((select color = '#12aB34' from public.trips where id = :'trip_id'), 'noncreator cannot update color');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select pg_temp.assert((select count(*) = 0 from public.trips where id = :'trip_id'), 'nonmember cannot read trip');
update public.trips set color = '#FFFFFF' where id = :'trip_id';
reset role;
delete from public.group_members where group_id = :'group_id' and user_id = '10000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
update public.trips set color = '#FFFFFF' where id = :'trip_id';
select pg_temp.assert((select count(*) = 0 from public.trips where id = :'trip_id'), 'revoked creator cannot read trip');
reset role;
select pg_temp.assert((select color = '#12aB34' from public.trips where id = :'trip_id'), 'unauthorized updates did not change color');
rollback;
