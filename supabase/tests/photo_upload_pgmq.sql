-- Disposable database only. Schema/function fixtures and data roll back.
-- Exercise both PGMQ versions even if the installed extension supports only one.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %', message; end if; end $$;
do $$ begin
  if to_regnamespace('pgmq') is not null then
    alter schema pgmq rename to pgmq_before_compat_test;
  end if;
end $$;
create schema pgmq;
create table pgmq.q_photo_upload(msg_id bigint primary key, message jsonb not null);
create table pgmq.read_calls(queue_name text, vt integer, qty integer, conditional jsonb);
create function pgmq.delete(queue_name text, msg_id bigint)
returns boolean language sql as $$
  with removed as (delete from pgmq.q_photo_upload q where q.msg_id=$2 returning 1)
  select exists(select 1 from removed);
$$;

select pg_temp.assert(not (public.upload_health()->>'queues')::boolean,
  'Missing read function is reported unavailable');
select public.upload_queue_reconcile();

insert into auth.users(id) values('30000000-0000-4000-8000-000000000001');
insert into public.groups(id,name,created_by)
  values('30000000-0000-4000-8000-000000000010','PGMQ compatibility','30000000-0000-4000-8000-000000000001');
insert into public.trips(id,group_id,title,created_by)
  values('30000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000010',
    'Queue test','30000000-0000-4000-8000-000000000001');
insert into upload_private.submissions(id,request_id,user_id,trip_id,group_id,phase,source_sha256,source_bytes)
  values('30000000-0000-4000-8000-000000000020','30000000-0000-4000-8000-000000000021',
    '30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000011',
    '30000000-0000-4000-8000-000000000010','original_check',repeat('f',64),10);
insert into upload_private.jobs(submission_id,stage,generation)
  values('30000000-0000-4000-8000-000000000020','original',0);
insert into pgmq.q_photo_upload values
  (1,'{"submission_id":"30000000-0000-4000-8000-000000000020","stage":"original","generation":0}'),
  (2,'{"submission_id":"30000000-0000-4000-8000-000000000099","stage":"original","generation":0}');

create function pgmq.read(queue_name text, vt integer, qty integer)
returns table(msg_id bigint, message jsonb) language plpgsql as $$
begin
  insert into pgmq.read_calls values(queue_name,vt,qty,null);
  return query select q.msg_id,q.message from pgmq.q_photo_upload q order by q.msg_id limit qty;
end $$;
select pg_temp.assert((public.upload_health()->>'queues')::boolean,
  'Legacy three-argument read is available');
select public.upload_queue_reconcile();
select pg_temp.assert(not exists(select 1 from pgmq.q_photo_upload where msg_id=1),
  'Legacy reconciliation acknowledges a message already persisted in jobs');
select pg_temp.assert(exists(select 1 from pgmq.q_photo_upload where msg_id=2),
  'Legacy reconciliation retains a message absent from jobs');
select pg_temp.assert((select count(*)=1 from pgmq.read_calls),
  'Legacy reconciliation actually invokes read');
drop function pgmq.read(text,integer,integer);

-- A fourth required parameter is incompatible with the three-argument call.
create function pgmq.read(queue_name text, vt integer, qty integer, conditional jsonb)
returns table(msg_id bigint, message jsonb) language plpgsql as $$
begin
  insert into pgmq.read_calls values(queue_name,vt,qty,conditional);
  return query select q.msg_id,q.message from pgmq.q_photo_upload q order by q.msg_id limit qty;
end $$;
select pg_temp.assert(not (public.upload_health()->>'queues')::boolean,
  'Four required parameters are reported unavailable');
select public.upload_queue_reconcile();
select pg_temp.assert((select count(*)=1 from pgmq.read_calls),
  'Reconciliation skips an incompatible signature');

create or replace function pgmq.read(queue_name text, vt integer, qty integer,
  conditional jsonb default '{}'::jsonb)
returns table(msg_id bigint, message jsonb) language plpgsql as $$
begin
  insert into pgmq.read_calls values(queue_name,vt,qty,conditional);
  return query select q.msg_id,q.message from pgmq.q_photo_upload q order by q.msg_id limit qty;
end $$;
select pg_temp.assert(to_regprocedure('pgmq.read(text,integer,integer)') is null,
  'Regression fixture has only the new four-argument signature');
select pg_temp.assert((public.upload_health()->>'queues')::boolean,
  'Optional fourth parameter is available');
insert into pgmq.q_photo_upload values
  (3,'{"submission_id":"30000000-0000-4000-8000-000000000020","stage":"original","generation":0}');
select pg_temp.assert(public.upload_claim()->>'submission_id'='30000000-0000-4000-8000-000000000020',
  'Worker claims the durable job with the new signature');
select pg_temp.assert(not exists(select 1 from pgmq.q_photo_upload where msg_id=3),
  'Worker claim reconciles and acknowledges the persisted message');
select pg_temp.assert(exists(select 1 from pgmq.q_photo_upload where msg_id=2),
  'New reconciliation retains a message absent from jobs');
select pg_temp.assert((select count(*)=2 from pgmq.read_calls),
  'Worker actually invokes the new read function');
select pg_temp.assert((select count(*)=1 from pgmq.read_calls
  where queue_name='photo_upload' and vt=120 and qty=100 and conditional='{}'::jsonb),
  'Worker preserves the visibility timeout and batch size and uses the default condition');
select pg_temp.assert(has_function_privilege('service_role','public.upload_health()','EXECUTE'),
  'Service role retains health access');
select pg_temp.assert(not has_function_privilege('anon','public.upload_health()','EXECUTE')
  and not has_function_privilege('authenticated','public.upload_health()','EXECUTE'),
  'Health remains unavailable to browser roles');
select pg_temp.assert(not exists(select 1 from pg_roles where rolname='supabase_read_only_user'
  and has_function_privilege(oid,'public.upload_health()','EXECUTE')),
  'Migration does not grant health access to the restricted read-only role');
select pg_temp.assert(not has_function_privilege('anon','upload_private.queue_read_available()','EXECUTE')
  and not has_function_privilege('authenticated','upload_private.queue_read_available()','EXECUTE'),
  'Compatibility helper remains unavailable to browser roles');
set local role service_role;
select pg_temp.assert((public.upload_health()->>'queues')::boolean,
  'Service role can execute the updated health function and private helper');
reset role;
rollback;
