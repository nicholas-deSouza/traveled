-- SQL Editor adapter. Main must execute: BEGIN; candidate migration; this file; ROLLBACK;
-- No transaction control here: never commit this fixture suite. SQL assertions
-- validate function behavior/permissions, not activation in the Auth service.
-- Hosted postgres cannot impersonate supabase_auth_admin. Hook value checks run
-- as the function owner after RESET ROLE; catalog ACL checks establish the Auth
-- role's grants, while a separate HTTP probe must establish runtime activation.
-- All persistent mutations target collision-guarded fixture users or newly
-- created fixture groups. No existing application rows are updated or deleted.
create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAILED: %', message; end if;
end;
$$;

-- Abort before fixture insertion if any reserved identity already exists.
do $$
begin
  if exists (select 1 from auth.users where id = any(array[
    '00000000-0000-0000-0000-000000000101'::uuid,
    '00000000-0000-0000-0000-000000000102'::uuid,
    '00000000-0000-0000-0000-000000000103'::uuid,
    '00000000-0000-0000-0000-000000000104'::uuid
  ])) or exists (select 1 from public.profiles where id = any(array[
    '00000000-0000-0000-0000-000000000101'::uuid,
    '00000000-0000-0000-0000-000000000102'::uuid,
    '00000000-0000-0000-0000-000000000103'::uuid,
    '00000000-0000-0000-0000-000000000104'::uuid
  ])) then
    raise exception 'FAILED: account security fixture UUID collision; no fixture rows inserted';
  end if;
end;
$$;

create temporary table account_security_fixture (
  singleton boolean primary key check (singleton),
  first_group uuid,
  second_group uuid,
  invitation text
) on commit drop;
insert into pg_temp.account_security_fixture(singleton) values (true);
revoke all on pg_temp.account_security_fixture from public, anon, authenticated, service_role, supabase_auth_admin;
grant select on pg_temp.account_security_fixture to authenticated;
grant update (first_group, second_group, invitation) on pg_temp.account_security_fixture to authenticated;
-- SQL Editor may supply JWT claims; clear them so the no-identity case cannot
-- fall back to its original caller. All settings are transaction-local.
select set_config('request.jwt.claims', '{}', true);

insert into auth.users (id, raw_user_meta_data) values
('00000000-0000-0000-0000-000000000101', '{"display_name":"Owner"}'),
('00000000-0000-0000-0000-000000000102', '{"display_name":"Member"}'),
('00000000-0000-0000-0000-000000000103', '{"display_name":"Outsider"}'),
('00000000-0000-0000-0000-000000000104', '{"display_name":"No groups"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
select pg_temp.assert((select count(*) = 1 from public.profiles), 'ungrouped users see only themselves');
select pg_temp.assert(not auth_private.shares_current_group('00000000-0000-0000-0000-000000000102'), 'ungrouped caller cannot discover unrelated profile');
update pg_temp.account_security_fixture set first_group = public.create_group('Account security first') where singleton;
update pg_temp.account_security_fixture set second_group = public.create_group('Account security second') where singleton;
-- Repository RPC returns TABLE(token text, expires_at timestamptz), not a scalar
-- token or JSON object. Qualify the correlated fixture and returned token.
update pg_temp.account_security_fixture as fixture set invitation =
  (select created.token from public.create_group_invitation(fixture.first_group) as created)
  where fixture.singleton;
select pg_temp.assert((select invitation ~ '^[a-f0-9]{64}$' from pg_temp.account_security_fixture where singleton), 'invitation RPC returns one usable text token');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
select pg_temp.assert((select count(*) = 1 from public.profiles), 'invitation possession grants no profile access');
select public.accept_group_invitation((select invitation from pg_temp.account_security_fixture where singleton));
insert into public.trips(group_id, title, created_by) values ((select first_group from pg_temp.account_security_fixture where singleton), 'Historical member trip', auth.uid());
select pg_temp.assert((select count(*) = 2 from public.profiles), 'member sees self and current owner only');
select pg_temp.assert((select count(*) = 2 from public.group_members m join public.profiles p on p.id = m.user_id where m.group_id = (select first_group from pg_temp.account_security_fixture where singleton)), 'roster join keeps member names');
select pg_temp.assert((select count(*) = 2 from public.group_members m join public.profiles p on p.id = m.user_id
  where m.group_id = (select first_group from pg_temp.account_security_fixture where singleton) and
    ((m.role = 'owner' and p.display_name = 'Owner') or (m.role = 'member' and p.display_name = 'Member'))), 'roster preserves names and owner/member roles');
select pg_temp.assert(auth_private.shares_current_group('00000000-0000-0000-0000-000000000101'), 'membership helper allows current peer');
select pg_temp.assert(auth_private.shares_current_group(auth.uid()), 'membership helper allows grouped self');
select pg_temp.assert(not auth_private.shares_current_group(null), 'membership helper rejects missing target');
update public.profiles set display_name = 'Updated member' where id = auth.uid();
select pg_temp.assert((select display_name = 'Updated member' from public.profiles where id = auth.uid()), 'self update remains available');
update public.profiles set display_name = 'Forged owner' where id = '00000000-0000-0000-0000-000000000101';
select pg_temp.assert((select display_name = 'Owner' from public.profiles where id = '00000000-0000-0000-0000-000000000101'), 'peer update changes no rows');
do $$
begin
  begin
    insert into public.profiles(id) values ('00000000-0000-0000-0000-000000000103');
    raise exception 'FAILED: peer insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set id = '00000000-0000-0000-0000-000000000104' where id = auth.uid();
    raise exception 'FAILED: identity reassignment allowed';
  exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000103', true);
select public.create_group('Account security disjoint');
select pg_temp.assert((select count(*) = 1 from public.profiles), 'disjoint group does not expose other profiles');
select pg_temp.assert((select count(*) = 0 from public.group_members where group_id = (select first_group from pg_temp.account_security_fixture where singleton)), 'outsider cannot read roster');

reset role;
insert into public.group_members(group_id, user_id) values ((select second_group from pg_temp.account_security_fixture where singleton), '00000000-0000-0000-0000-000000000102');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000101', true);
select pg_temp.assert((select count(*) = 2 from public.profiles), 'owner sees peer in both directions');
delete from public.group_members where group_id = (select first_group from pg_temp.account_security_fixture where singleton) and user_id = '00000000-0000-0000-0000-000000000102';
select pg_temp.assert((select count(*) = 2 from public.profiles), 'another shared group preserves visibility');
delete from public.group_members where group_id = (select second_group from pg_temp.account_security_fixture where singleton) and user_id = '00000000-0000-0000-0000-000000000102';
select pg_temp.assert((select count(*) = 1 from public.profiles), 'last shared membership removal hides peer');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000102', true);
select pg_temp.assert((select count(*) = 1 from public.profiles), 'removed member cannot enumerate former peers');
select pg_temp.assert(not auth_private.shares_current_group('00000000-0000-0000-0000-000000000101'), 'helper revokes last shared peer');
select pg_temp.assert((select count(*) = 0 from public.group_members where group_id = (select first_group from pg_temp.account_security_fixture where singleton)), 'removed member cannot read former roster');
select pg_temp.assert((select count(*) = 0 from public.trips where group_id = (select first_group from pg_temp.account_security_fixture where singleton)), 'historical authorship does not preserve trip or peer access');
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.assert((select count(*) = 0 from public.profiles), 'authenticated role without identity sees nothing');
select pg_temp.assert(not auth_private.shares_current_group('00000000-0000-0000-0000-000000000101'), 'helper does not trust a caller-supplied identity');

set local role anon;
do $$
declare visible bigint := 0;
begin
  begin select count(*) into visible from public.profiles;
  exception when insufficient_privilege then visible := 0; end;
  if visible <> 0 then raise exception 'FAILED: anonymous profile enumeration'; end if;
end;
$$;

reset role;
select pg_temp.assert(not has_function_privilege('anon', 'auth_private.shares_current_group(uuid)', 'EXECUTE'), 'anonymous cannot execute membership helper');
select pg_temp.assert(not has_function_privilege('authenticated', 'auth_private.before_user_created(jsonb)', 'EXECUTE'), 'client cannot execute signup hook');
select pg_temp.assert(not has_function_privilege('anon', 'auth_private.before_user_created(jsonb)', 'EXECUTE'), 'anonymous cannot execute signup hook');
select pg_temp.assert(not has_function_privilege('service_role', 'auth_private.before_user_created(jsonb)', 'EXECUTE'), 'default service grant cannot expose signup hook');
select pg_temp.assert(not has_function_privilege('service_role', 'auth_private.shares_current_group(uuid)', 'EXECUTE'), 'default service grant cannot expose membership helper');
select pg_temp.assert(has_function_privilege('supabase_auth_admin', 'auth_private.before_user_created(jsonb)', 'EXECUTE')
  and has_schema_privilege('supabase_auth_admin', 'auth_private', 'USAGE'), 'Auth role has hook EXECUTE and schema USAGE grants');
select pg_temp.assert(not has_schema_privilege('authenticated', 'auth_private', 'CREATE'), 'client cannot replace private helpers');
select pg_temp.assert((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'auth_private.shares_current_group(uuid)'::regprocedure), 'membership helper has fixed search path');
select pg_temp.assert((select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'auth_private.before_user_created(jsonb)'::regprocedure), 'signup hook is invoker with fixed search path');
select pg_temp.assert(not exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles'
  and policyname = 'profiles are readable by signed-in users'), 'global profile read policy removed');
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles remain RLS protected');

-- Still the function owner from RESET ROLE above, not the Auth runtime role.
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":"normal+tag@example.com"}}') = '{}', 'plus addressing accepted');
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":"drop.table@example.com"}}') = '{}', 'SQL words in valid email accepted');
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":"USER@EXAMPLE.COM"}}') = '{}', 'uppercase ASCII accepted');
select pg_temp.assert(auth_private.before_user_created(jsonb_build_object('user', jsonb_build_object('email', repeat('a',65)||'@example.test'))) =
  '{"error":{"http_code":400,"message":"Enter a valid email address using only ASCII characters."}}'::jsonb, 'activation probe returns distinctive hook rejection');
select pg_temp.assert(auth_private.before_user_created('null'::jsonb) ? 'error', 'null event rejected');
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":null}}') ? 'error', 'null email rejected');
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":""}}') ? 'error', 'empty email rejected');
select pg_temp.assert(auth_private.before_user_created(jsonb_build_object('user', jsonb_build_object('email', repeat('a',64)||'@'||repeat('b',63)||'.'||repeat('c',63)||'.'||repeat('d',61)))) = '{}', '254 character email and 64 character local part accepted');
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":" emoji😀@example.com "}}') #>> '{error,http_code}' = '400', 'emoji rejected at server boundary');
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":".name@example.com"}}') ? 'error', 'leading dot rejected');
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":"name..part@example.com"}}') ? 'error', 'consecutive dots rejected');
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":"name.@example.com"}}') ? 'error', 'trailing dot rejected');
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":"name@-example.com"}}') ? 'error', 'malformed domain rejected');
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":"name@example.com\n"}}') ? 'error', 'newline suffix rejected');
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":"name@@example.com"}}') ? 'error', 'multiple at signs rejected');
select pg_temp.assert(auth_private.before_user_created('{"user":{"email":42}}') ? 'error', 'nonstring rejected');
select pg_temp.assert(auth_private.before_user_created('{"user":{}}') ? 'error', 'missing email rejected');
select pg_temp.assert(auth_private.before_user_created(jsonb_build_object('user', jsonb_build_object('email', repeat('a',65)||'@example.com'))) ? 'error', 'oversized local part rejected');
select pg_temp.assert(auth_private.before_user_created(jsonb_build_object('user', jsonb_build_object('email', 'a@'||repeat('b',64)||'.com'))) ? 'error', 'oversized label rejected');
select pg_temp.assert(auth_private.before_user_created(jsonb_build_object('user', jsonb_build_object('email', repeat('a',64)||'@'||repeat('b',63)||'.'||repeat('c',63)||'.'||repeat('d',63)))) ? 'error', 'oversized total length rejected');
reset role;
select 'account_security SQL assertions passed; verify Auth hook activation separately' as result;
