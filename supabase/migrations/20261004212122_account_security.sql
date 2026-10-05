-- Keep roster names visible without allowing global profile enumeration.
create schema if not exists auth_private;
revoke all on schema auth_private from public, anon, authenticated;
grant usage on schema auth_private to authenticated, supabase_auth_admin;

create function auth_private.shares_current_group(target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.group_members caller
    join public.group_members peer on peer.group_id = caller.group_id
    where caller.user_id = (select auth.uid()) and peer.user_id = target_user_id
  );
$$;
-- Supabase may grant function EXECUTE to service_role via default privileges.
-- Remove that inherited API grant as well; only authenticated policy evaluation
-- needs this helper, and only Auth's dedicated role needs the signup hook.
revoke all on function auth_private.shares_current_group(uuid) from public, anon, authenticated, service_role, supabase_auth_admin;
grant execute on function auth_private.shares_current_group(uuid) to authenticated;

drop policy "profiles are readable by signed-in users" on public.profiles;
create policy "users read themselves and current group peers" on public.profiles
for select to authenticated
using (id = (select auth.uid()) or auth_private.shares_current_group(id));

-- Pure validation: Auth calls this as supabase_auth_admin, without elevated
-- table access. This runs only for creation, not login or email changes.
create function auth_private.before_user_created(event jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = '' as $hook$
declare
  email text := pg_catalog.btrim(event -> 'user' ->> 'email');
  local_part text := pg_catalog.split_part(email, '@', 1);
begin
  if pg_catalog.jsonb_typeof(event -> 'user' -> 'email') is distinct from 'string'
    or email is null or pg_catalog.length(email) > 254
    or pg_catalog.length(local_part) > 64
    or not (email collate "C" ~ $pattern$^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$$pattern$)
    or local_part like '.%' or local_part like '%.' or local_part like '%..%'
  then
    return '{"error":{"http_code":400,"message":"Enter a valid email address using only ASCII characters."}}'::jsonb;
  end if;
  return '{}'::jsonb;
end;
$hook$;
revoke all on function auth_private.before_user_created(jsonb) from public, anon, authenticated, service_role;
grant execute on function auth_private.before_user_created(jsonb) to supabase_auth_admin;
