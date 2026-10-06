-- Disposable database only. Every switch change and fixture rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %', message; end if; end $$;

create temporary table admission_state(enabled_before boolean, revision bigint);
update upload_private.settings set admission_enabled = true where singleton;

-- Match the deployment's atomic pause query, including its row lock.
with previous as materialized (
  select admission_enabled from upload_private.settings where singleton for update
), paused as (
  update upload_private.settings s set admission_enabled = false
  from previous where s.singleton
  returning previous.admission_enabled as enabled_before, s.admission_revision as revision
)
insert into admission_state select * from paused;
select pg_temp.assert((select enabled_before from admission_state), 'Pause remembers enabled admission');
select pg_temp.assert((select not admission_enabled from upload_private.settings where singleton), 'Pause disables new admission');

-- Normal worker updates must not invalidate automatic resume.
set local role service_role;
update upload_private.settings set provider_ready_at = now() where singleton;
reset role;
select pg_temp.assert((select admission_revision = (select revision from admission_state)
  from upload_private.settings where singleton), 'Worker updates preserve the admission revision');
with resumed as (
  update upload_private.settings set admission_enabled = true
  where singleton and admission_enabled = false and admission_revision = (select revision from admission_state)
  returning admission_revision
)
select pg_temp.assert((select count(*) = 1 from resumed), 'The owning deployment can resume');
select pg_temp.assert((select admission_enabled and admission_revision = (select revision + 1 from admission_state)
  from upload_private.settings where singleton), 'Resume enables admission and advances the revision');

-- A later explicit pause, even when already false, invalidates the saved revision.
update upload_private.settings set admission_enabled = false where singleton;
update admission_state set revision = (select admission_revision from upload_private.settings where singleton);
update upload_private.settings set admission_enabled = false where singleton;
with resumed as (
  update upload_private.settings set admission_enabled = true
  where singleton and admission_enabled = false and admission_revision = (select revision from admission_state)
  returning admission_revision
)
select pg_temp.assert((select count(*) = 0 from resumed), 'An intervening same-value operator pause blocks resume');
select pg_temp.assert((select not admission_enabled from upload_private.settings where singleton), 'Operator pause stays in effect');

-- Admission remains private and the trigger grants no new public capability.
select pg_temp.assert(not has_function_privilege('anon', 'upload_private.bump_admission_revision()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'upload_private.bump_admission_revision()', 'EXECUTE'),
  'Browser roles cannot execute the admission trigger function');
select pg_temp.assert((select relrowsecurity from pg_class where oid = 'upload_private.settings'::regclass),
  'Settings retain RLS');
rollback;
