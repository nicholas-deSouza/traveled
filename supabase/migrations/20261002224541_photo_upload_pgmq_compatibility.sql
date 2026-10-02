-- PGMQ added a defaulted conditional JSONB argument to read(). Exact
-- three-argument identity checks miss that callable four-argument function.
-- Keep the existing three-argument calls and accept only compatible signatures.
create function upload_private.queue_read_available()
returns boolean language sql stable set search_path = '' as $$
  select exists(
    select 1 from pg_catalog.pg_proc p
    where p.oid=pg_catalog.to_regprocedure('pgmq.read(text,integer,integer)')
      or (p.oid=pg_catalog.to_regprocedure('pgmq.read(text,integer,integer,jsonb)')
        and p.pronargdefaults>=1)
  );
$$;
revoke all on function upload_private.queue_read_available() from public,anon,authenticated;
grant execute on function upload_private.queue_read_available() to service_role;

-- CREATE OR REPLACE retains each existing function's owner and EXECUTE grants.
-- Only the capability checks change; job reconciliation and leases stay intact.
create or replace function public.upload_claim()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j upload_private.jobs; s upload_private.submissions; o upload_private.objects; token uuid;
begin
  perform 1 from upload_private.settings where singleton for update;
  -- Reconcile at most 100 identities per call. The partial expiry/eligibility
  -- indexes and SKIP LOCKED claims keep recovery bounded.
  for s in select * from upload_private.submissions where outcome is null and
    (expires_at<=now() or not upload_private.member(user_id,trip_id)) order by created_at limit 100 for update skip locked loop
    perform upload_private.terminate(s.id,case when s.expires_at<=now() then 'expired' else 'access_revoked' end);
  end loop;
  for s in select * from upload_private.submissions where outcome='published' and
    not exists(select 1 from public.photos where id=submissions.id) limit 100 for update skip locked loop
    update upload_private.submissions set outcome='deleted',cleanup_pending=true where id=s.id;
    update upload_private.objects set retired=true where submission_id=s.id;
  end loop;
  for s in select * from upload_private.submissions where outcome is null and pause_reason is distinct from 'technical' and phase='original_upload' and exists(
    select 1 from upload_private.objects obj_entry join storage.objects b on b.bucket_id=obj_entry.bucket and b.name=obj_entry.path
      where obj_entry.submission_id=submissions.id and obj_entry.stage='original' and b.metadata->>'size' ~ '^[0-9]+$') limit 100 for update skip locked loop
    update upload_private.submissions set phase='original_check' where id=s.id;
    perform upload_private.enqueue(s.id,'original',0);
  end loop;
  -- Tombstones also discover bytes created after a previous successful delete.
  update upload_private.objects obj_entry set deleted_at=null where deleted_at is not null and exists(
    select 1 from storage.objects b where b.bucket_id=obj_entry.bucket and b.name=obj_entry.path)
    and exists(select 1 from upload_private.submissions sub_entry where sub_entry.id=obj_entry.submission_id and
      (obj_entry.retired or sub_entry.outcome is not null and (sub_entry.outcome<>'published' or obj_entry.stage<>'publication')));
  for s in select distinct sub_entry.* from upload_private.submissions sub_entry join upload_private.objects obj_entry on obj_entry.submission_id=sub_entry.id
    where obj_entry.deleted_at is null and (obj_entry.retired or sub_entry.outcome is not null and (sub_entry.outcome<>'published' or obj_entry.stage<>'publication')) limit 100 loop
    update upload_private.submissions set cleanup_pending=true where id=s.id;
    insert into upload_private.jobs(submission_id,stage,generation) values(s.id,'cleanup',0)
      on conflict(submission_id,stage,generation) do update set
        status=case when jobs.status='done' then 'ready' else jobs.status end,
        due_at=case when jobs.status='done' then now() else jobs.due_at end;
  end loop;
  -- A queue delivery is acknowledged only after this call reconciles it into
  -- the durable jobs ledger. It is never destructively popped before persistence.
  if upload_private.queue_read_available() then
    perform public.upload_queue_reconcile();
  end if;
  -- A timeout consumes one technical attempt. Backoff is computed from the
  -- expired lease rather than immediately dispatching an unlimited new cycle.
  update upload_private.submissions sub_entry set attempts=job_entry.attempts,
    retry_at=case when job_entry.attempts>=5 then null else now()+make_interval(secs=>power(2,job_entry.attempts)+random()) end,
    pause_reason=case when job_entry.attempts>=5 then 'technical' else null end,error='This stage could not finish'
    from upload_private.jobs job_entry where job_entry.submission_id=sub_entry.id and job_entry.stage<>'cleanup' and sub_entry.outcome is null
      and job_entry.status='leased' and job_entry.lease_until<=now();
  update upload_private.jobs set status=case when attempts>=5 then 'failed' else 'ready' end,lease_until=null,
    due_at=now()+make_interval(secs=>case when attempts>=5 and stage='cleanup' then 86400 else power(2,attempts)+random() end)
    where status='leased' and lease_until<=now();
  select * into j from upload_private.jobs where
    (status='ready' and due_at<=now() or status='leased' and lease_until<=now()
      or status='failed' and stage='cleanup' and due_at<=now())
    and (retry_minimum_at is null or retry_minimum_at<=now())
    and (stage='cleanup' or exists(select 1 from upload_private.submissions sub_entry where sub_entry.id=jobs.submission_id and sub_entry.outcome is null
      and (jobs.stage='original' or jobs.generation=sub_entry.generation)))
    and (stage not in ('original','candidate') or exists(select 1 from upload_private.settings where singleton and
      (provider_until is null or provider_until<=now()) and provider_ready_at<=now()))
    order by due_at,stage='cleanup' desc limit 1 for update skip locked;
  if j.submission_id is null then return null; end if;
  select * into s from upload_private.submissions where id=j.submission_id for update;
  token := gen_random_uuid();
  if j.stage='cleanup' and j.status='failed' then j.attempts := 0; end if;
  update upload_private.jobs set status='leased',attempt_id=token,lease_until=now()+interval '120 seconds',
    attempts=j.attempts+1 where submission_id=j.submission_id and stage=j.stage and generation=j.generation;
  if j.stage in ('original','candidate') then
    update upload_private.settings set provider_lease=token,provider_until=now()+interval '120 seconds' where singleton;
    select * into o from upload_private.objects where submission_id=j.submission_id and stage=j.stage and generation=j.generation;
    return jsonb_build_object('submission_id',j.submission_id,'stage',j.stage,'generation',j.generation,'attempt_id',token,
      'bucket',o.bucket,'path',o.path,'expected_sha256',o.expected_sha256,'expected_bytes',o.expected_bytes);
  elsif j.stage='publication' then
    select * into o from upload_private.objects where submission_id=j.submission_id and stage='publication' and generation=j.generation;
    return jsonb_build_object('submission_id',j.submission_id,'stage',j.stage,'generation',j.generation,'attempt_id',token,
      'destination',o.path,'source',s.user_id||'/'||s.id||'/candidate-'||j.generation||'.webp');
  end if;
  return jsonb_build_object('submission_id',j.submission_id,'stage',j.stage,'generation',j.generation,'attempt_id',token,'objects',
    coalesce((select jsonb_agg(jsonb_build_object('bucket',obj_entry.bucket,'path',obj_entry.path)) from upload_private.objects obj_entry
      where obj_entry.submission_id=j.submission_id and obj_entry.deleted_at is null and
      (obj_entry.retired or s.outcome is not null and (s.outcome<>'published' or obj_entry.stage<>'publication'))),'[]'::jsonb));
end $$;

create or replace function public.upload_queue_reconcile()
returns void language plpgsql security definer set search_path = '' as $$
declare delivery record;
begin
  if upload_private.queue_read_available() then
    for delivery in select * from pgmq.read('photo_upload',120,100) loop
      if exists(select 1 from upload_private.jobs where submission_id=(delivery.message->>'submission_id')::uuid
        and stage=delivery.message->>'stage' and generation=(delivery.message->>'generation')::integer) then
        perform pgmq.delete('photo_upload',delivery.msg_id);
      end if;
    end loop;
  end if;
end $$;

create or replace function public.upload_health()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare scheduled boolean := false;
begin
  if to_regclass('cron.job') is not null then
    execute 'select exists(select 1 from cron.job where jobname=''photo-upload-worker'' and active)' into scheduled;
  end if;
  return jsonb_build_object('admission_enabled',(select admission_enabled from upload_private.settings where singleton),
    'queues',upload_private.queue_read_available(),
    'cron',exists(select 1 from pg_extension where extname='pg_cron'),
    'pg_net',exists(select 1 from pg_extension where extname='pg_net'),'scheduled',scheduled,
    'unfinished',(select count(*) from upload_private.submissions where outcome is null),
    'quota_paused',(select count(*) from upload_private.submissions where pause_reason='quota' and outcome is null),
    'cleanup_pending',(select count(*) from upload_private.submissions where cleanup_pending),
    'failed_jobs',(select count(*) from upload_private.jobs where status='failed'),
    'expired_leases',(select count(*) from upload_private.jobs where status='leased' and lease_until<now()),
    'oldest_ready_job_seconds',(select coalesce(extract(epoch from now()-min(due_at)),0) from upload_private.jobs where status='ready' and due_at<=now()),
    'storage_bytes',(select coalesce(sum(case when metadata->>'size' ~ '^[0-9]+$' then (metadata->>'size')::bigint else 0 end),0) from storage.objects),
    'outstanding_reservation_bytes',(select coalesce(sum(greatest(obj_entry.reservation_bytes-coalesce(
      case when storage_entry.metadata->>'size' ~ '^[0-9]+$' then (storage_entry.metadata->>'size')::bigint else 0 end,0),0)),0)
      from upload_private.objects obj_entry left join storage.objects storage_entry on storage_entry.bucket_id=obj_entry.bucket and storage_entry.name=obj_entry.path));
end;
$$;
