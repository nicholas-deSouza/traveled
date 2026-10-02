-- Apply all migrations first; every fixture rolls back. Requires only SQL
-- stand-ins for Auth/Storage, or a disposable local Supabase instance.
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAILED: %',message; end if; end $$;
create function pg_temp.denied(statement text) returns void language plpgsql as $$
begin
  begin execute statement; exception when insufficient_privilege then return; end;
  raise exception 'FAILED: forbidden operation allowed: %',statement;
end $$;
insert into auth.users(id) values('20000000-0000-4000-8000-000000000001'),('20000000-0000-4000-8000-000000000002');
insert into public.groups(id,name,created_by) values('20000000-0000-4000-8000-000000000010','Upload test','20000000-0000-4000-8000-000000000001');
insert into public.trips(id,group_id,title,created_by) values('20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000010','Upload trip','20000000-0000-4000-8000-000000000001');
update upload_private.settings set admission_enabled=true;
select public.upload_command('20000000-0000-4000-8000-000000000001',jsonb_build_object('action','admit',
 'id','20000000-0000-4000-8000-000000000020','request_id','20000000-0000-4000-8000-000000000021',
 'trip_id','20000000-0000-4000-8000-000000000011','filename','travel.jpg','source_sha256',repeat('f',64),'source_bytes',10));
select public.upload_command('20000000-0000-4000-8000-000000000001',jsonb_build_object('action','admit',
 'id','20000000-0000-4000-8000-000000000020','request_id','20000000-0000-4000-8000-000000000021',
 'trip_id','20000000-0000-4000-8000-000000000011','filename','travel.jpg','source_sha256',repeat('f',64),'source_bytes',10));
select pg_temp.assert((select count(*)=3 from upload_private.objects),'Idempotent admission has only three reservations');
select pg_temp.assert((select sum(reservation_bytes)=50331648 from upload_private.objects),'Conservative 48 MiB reservation');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.denied($q$select public.upload_claim()$q$);
select pg_temp.denied($q$select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"list"}')$q$);
select pg_temp.denied($q$insert into public.photos(id,trip_id,uploaded_by,storage_path) values('20000000-0000-4000-8000-000000000020','20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000001','forged')$q$);
select pg_temp.denied($q$insert into storage.objects(bucket_id,name,owner_id) values('trip-photos','forged','20000000-0000-4000-8000-000000000001')$q$);
insert into storage.objects(bucket_id,name,owner_id,metadata) values('photo-quarantine','20000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000020/original','20000000-0000-4000-8000-000000000001','{"size":10}');
select pg_temp.assert((select count(*)=0 from storage.objects where bucket_id='photo-quarantine'),'Unapproved originals cannot be downloaded');
select pg_temp.denied($q$insert into storage.objects(bucket_id,name,owner_id) values('photo-quarantine','arbitrary','20000000-0000-4000-8000-000000000001')$q$);
reset role;
select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"original_uploaded","id":"20000000-0000-4000-8000-000000000020"}');
select public.upload_claim()::text as original_job \gset
select pg_temp.assert(public.upload_finish(:'original_job'::jsonb||jsonb_build_object('outcome','approved','sha256',repeat('f',64),'bytes',10)),'Original approval commits');
select pg_temp.assert(not public.upload_finish(:'original_job'::jsonb||jsonb_build_object('outcome','approved','sha256',repeat('f',64),'bytes',10)),'Duplicate/stale lease completion is ignored');
select pg_temp.assert((select reservation_bytes=10 from upload_private.objects where stage='original'),'Only verified bytes refund original reservation');
set local role authenticated;
select pg_temp.assert((select count(*)=1 from storage.objects where bucket_id='photo-quarantine'),'Approved original can be recovered');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000002',true);
select pg_temp.assert((select count(*)=0 from storage.objects where bucket_id='photo-quarantine'),'Other accounts cannot recover approved original');
reset role;
select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"gps","id":"20000000-0000-4000-8000-000000000020","latitude":null,"longitude":null}');
select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"candidate","id":"20000000-0000-4000-8000-000000000020","request_id":"20000000-0000-4000-8000-000000000022"}');
select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"candidate","id":"20000000-0000-4000-8000-000000000020","request_id":"20000000-0000-4000-8000-000000000022"}');
select pg_temp.assert((select generation=1 from upload_private.submissions),'Same candidate request preserves generation');
insert into storage.objects(bucket_id,name,metadata) values('photo-quarantine','20000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000020/candidate-1.webp','{"size":8}');
select public.upload_command('20000000-0000-4000-8000-000000000001',jsonb_build_object('action','candidate_uploaded','id','20000000-0000-4000-8000-000000000020','generation',1,'sha256',repeat('a',64),'bytes',8));
update upload_private.settings set provider_ready_at=now();
select public.upload_claim()::text as candidate_job \gset
select pg_temp.assert(public.upload_finish(:'candidate_job'::jsonb||jsonb_build_object('outcome','approved','sha256',repeat('a',64),'bytes',8)),'Candidate approval commits');
select public.upload_claim()::text as publication_job \gset
insert into storage.objects(bucket_id,name,metadata) values('trip-photos',(:'publication_job'::jsonb->>'destination'),'{"size":8}');
set local role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
select pg_temp.assert((select count(*)=0 from storage.objects where bucket_id='trip-photos'),'Copied objects are invisible before publication');
reset role;
select pg_temp.assert(public.upload_finish(:'publication_job'::jsonb||'{"outcome":"published"}'::jsonb),'Publication commits all gates');
select pg_temp.assert((select count(*)=1 from public.photos),'Exactly one committed gallery photo');
set local role authenticated;
select pg_temp.assert((select count(*)=1 from storage.objects where bucket_id='trip-photos'),'Committed photo opens gallery read gate');
reset role;
select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"delete","id":"20000000-0000-4000-8000-000000000020"}');
select pg_temp.assert((select count(*)=0 from public.photos),'Trusted deletion removes visibility first');
select public.upload_claim()::text as cleanup_job \gset
delete from storage.objects where name in(select value->>'path' from jsonb_array_elements(:'cleanup_job'::jsonb->'objects'));
select pg_temp.assert(public.upload_finish(:'cleanup_job'::jsonb||jsonb_build_object('outcome','cleaned','removed',:'cleanup_job'::jsonb->'objects')),'Cleanup commits per-path progress');
select pg_temp.assert((select filename is null and source_sha256 is null and latitude is null and not cleanup_pending from upload_private.submissions),'Cleanup scrubs sensitive submission metadata');
select pg_temp.assert((select count(*)=3 from upload_private.objects),'Permanent minimal path tombstones survive cleanup');
-- Reappearance after successful cleanup is discovered and cannot regain reads.
insert into storage.objects(bucket_id,name,metadata) values('photo-quarantine','20000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000020/original','{"size":10}');
select public.upload_claim()::text as late_cleanup_job \gset
select pg_temp.assert(:'late_cleanup_job'::jsonb->>'stage'='cleanup','Late upload reopens cleanup');
select pg_temp.assert((select outcome='deleted' from upload_private.submissions),'Late object does not resurrect submission');
-- Fixed expiry and records survive a trip being deleted.
select public.upload_command('20000000-0000-4000-8000-000000000001',jsonb_build_object('action','admit','id','20000000-0000-4000-8000-000000000030',
 'request_id','20000000-0000-4000-8000-000000000031','trip_id','20000000-0000-4000-8000-000000000011','filename','later.jpg','source_sha256',repeat('b',64),'source_bytes',10));
update upload_private.submissions set expires_at=now()-interval '1 second' where id='20000000-0000-4000-8000-000000000030';
select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"reconcile","id":"20000000-0000-4000-8000-000000000030"}');
select pg_temp.assert((select outcome='expired' from upload_private.submissions where id='20000000-0000-4000-8000-000000000030'),'Reconciliation enforces fixed expiry');
-- Provider minima longer than the submission's lifetime cannot be shortened
-- by automatic claims or manual retry. Quota pauses consume no attempts.
insert into upload_private.submissions(id,request_id,user_id,trip_id,group_id,phase,source_sha256,source_bytes)
 values('20000000-0000-4000-8000-000000000040','20000000-0000-4000-8000-000000000041',
 '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000010','original_check',repeat('c',64),10);
insert into upload_private.jobs(submission_id,stage,generation,status,attempts,attempt_id,lease_until)
 values('20000000-0000-4000-8000-000000000040','original',0,'leased',1,'20000000-0000-4000-8000-000000000042',now()+interval '120 seconds');
update upload_private.settings set provider_lease='20000000-0000-4000-8000-000000000042',provider_until=now()+interval '120 seconds';
select pg_temp.assert(public.upload_finish(jsonb_build_object('submission_id','20000000-0000-4000-8000-000000000040','stage','original',
 'generation',0,'attempt_id','20000000-0000-4000-8000-000000000042','outcome','quota','retry_after_seconds',691200)),'Quota pause persists');
select pg_temp.assert((select attempts=0 and retry_minimum_at>=now()+interval '8 days' from upload_private.jobs
 where submission_id='20000000-0000-4000-8000-000000000040'),'Quota minimum is preserved beyond seven days and consumes no attempt');
select pg_temp.assert((select provider_ready_at>=now()+interval '8 days' from upload_private.settings),'Global provider quota pauses all new dispatch');
-- Cancel wins over a copied-but-uncommitted publication, using the same row lock.
insert into upload_private.submissions(id,request_id,user_id,trip_id,group_id,phase,original_approved,candidate_approved,gps_acknowledged)
 values('20000000-0000-4000-8000-000000000050','20000000-0000-4000-8000-000000000051',
 '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000010','publication',true,true,true);
insert into upload_private.objects(bucket,path,submission_id,stage,generation,reservation_bytes)
 values('trip-photos','orphan-copy','20000000-0000-4000-8000-000000000050','publication',1,8388608);
insert into storage.objects(bucket_id,name,metadata) values('trip-photos','orphan-copy','{"size":8}');
insert into upload_private.jobs(submission_id,stage,generation,status,attempts,attempt_id,lease_until)
 values('20000000-0000-4000-8000-000000000050','publication',1,'leased',1,'20000000-0000-4000-8000-000000000052',now()+interval '120 seconds');
select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"cancel","id":"20000000-0000-4000-8000-000000000050"}');
select pg_temp.assert(not public.upload_finish('{"submission_id":"20000000-0000-4000-8000-000000000050","stage":"publication","generation":1,"attempt_id":"20000000-0000-4000-8000-000000000052","outcome":"published"}'),'Canceled publication ignores its stale copied result');
select pg_temp.assert(not exists(select 1 from public.photos where storage_path='orphan-copy'),'Canceled copied object remains invisible');
select pg_temp.assert(exists(select 1 from upload_private.jobs where submission_id='20000000-0000-4000-8000-000000000050' and stage='cleanup'),'Cancel schedules orphan cleanup atomically');
select public.upload_command('20000000-0000-4000-8000-000000000001',jsonb_build_object('action','admit','id','20000000-0000-4000-8000-000000000060',
 'request_id','20000000-0000-4000-8000-000000000061','trip_id','20000000-0000-4000-8000-000000000011','filename','browser.jpg','source_sha256',repeat('d',64),'source_bytes',10));
select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"browser_failure","id":"20000000-0000-4000-8000-000000000060","stage":"original_upload","generation":2}');
select pg_temp.assert((select pause_reason is null from upload_private.submissions where id='20000000-0000-4000-8000-000000000060'),'Stale browser generation cannot pause current work');
select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"browser_failure","id":"20000000-0000-4000-8000-000000000060","stage":"original_upload","generation":1}');
select pg_temp.assert((select pause_reason='technical' from upload_private.submissions where id='20000000-0000-4000-8000-000000000060'),'Exhausted browser phase persists manual retry state');
select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"retry","id":"20000000-0000-4000-8000-000000000060"}');
select pg_temp.assert((select pause_reason is null from upload_private.submissions where id='20000000-0000-4000-8000-000000000060'),'Manual browser retry reacquires queue eligibility');
select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"cancel","id":"20000000-0000-4000-8000-000000000070"}');
select public.upload_command('20000000-0000-4000-8000-000000000001','{"action":"cancel","id":"20000000-0000-4000-8000-000000000070"}');
select pg_temp.assert((select outcome='canceled' and not cleanup_pending and filename is null and source_sha256 is null and source_bytes is null
 from upload_private.submissions where id='20000000-0000-4000-8000-000000000070'),'Cancel before admission stores a minimal permanent tombstone');
select pg_temp.assert(not exists(select 1 from upload_private.objects where submission_id='20000000-0000-4000-8000-000000000070'),'Cancel before admission authorizes no paths or reservations');
do $$ begin
  begin
    perform public.upload_command('20000000-0000-4000-8000-000000000001',jsonb_build_object('action','admit','id','20000000-0000-4000-8000-000000000070',
      'request_id','20000000-0000-4000-8000-000000000071','trip_id','20000000-0000-4000-8000-000000000011','filename','late.jpg','source_sha256',repeat('e',64),'source_bytes',10));
    raise exception 'FAILED: Late admission resurrected a canceled identity';
  exception when unique_violation then null; end;
end $$;
select pg_temp.assert((select outcome='canceled' from upload_private.submissions where id='20000000-0000-4000-8000-000000000070'),'Late admission preserves the canceled outcome');
select pg_temp.denied($q$select public.upload_command('20000000-0000-4000-8000-000000000002','{"action":"cancel","id":"20000000-0000-4000-8000-000000000070"}')$q$);
delete from public.trips where id='20000000-0000-4000-8000-000000000011';
select pg_temp.assert((select count(*)=6 from upload_private.submissions),'Trip deletion keeps cleanup identities');
select pg_temp.assert((select count(*)=10 from upload_private.objects),'Trip deletion keeps cleanup paths');
rollback;
