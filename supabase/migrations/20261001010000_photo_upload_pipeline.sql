-- ADR 0002. Submission identities and object tombstones deliberately have no
-- trip/profile foreign keys: deletion must never erase outstanding cleanup.
create schema if not exists upload_private;
revoke all on schema upload_private from public, anon, authenticated;
grant usage on schema upload_private to service_role;

create table upload_private.settings (
  singleton boolean primary key default true check (singleton),
  admission_enabled boolean not null default false,
  budget_bytes bigint not null default 838860800,
  provider_lease uuid, provider_until timestamptz,
  provider_ready_at timestamptz not null default now()
);
insert into upload_private.settings (singleton) values (true);
create table upload_private.submissions (
  id uuid primary key, request_id uuid not null, user_id uuid not null,
  trip_id uuid not null, group_id uuid not null, filename text,
  phase text not null default 'original_upload', outcome text,
  generation integer not null default 1,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  gps_acknowledged boolean not null default false,
  latitude double precision, longitude double precision,
  source_sha256 text, source_bytes bigint,
  original_approved boolean not null default false,
  candidate_approved boolean not null default false,
  retry_at timestamptz, attempts integer not null default 0,
  error text, pause_reason text, cleanup_pending boolean not null default false,
  unique (user_id, request_id),
  check (phase in ('original_upload','original_check','gps','processing','candidate_upload','candidate_check','publication','complete')),
  check (outcome is null or outcome in ('published','rejected','invalid','canceled','expired','deleted','access_revoked')),
  check ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180)),
  check (source_sha256 is null or source_sha256 ~ '^[a-f0-9]{64}$')
);
create index submissions_owner on upload_private.submissions(user_id, created_at);
create index submissions_expiry on upload_private.submissions(expires_at) where outcome is null;
create table upload_private.objects (
  bucket text not null, path text not null, submission_id uuid not null references upload_private.submissions(id),
  stage text not null check (stage in ('original','candidate','publication')), generation integer not null,
  expected_sha256 text, expected_bytes bigint, verified_bytes bigint,
  reservation_bytes bigint not null check (reservation_bytes >= 0),
  retired boolean not null default false, deleted_at timestamptz,
  primary key (bucket, path), unique (submission_id, stage, generation)
);
create index objects_submission on upload_private.objects(submission_id);
create table upload_private.requests (
  submission_id uuid not null references upload_private.submissions(id), request_id uuid not null,
  generation integer not null, primary key(submission_id, request_id)
);
create table upload_private.jobs (
  submission_id uuid not null references upload_private.submissions(id),
  stage text not null check (stage in ('original','candidate','publication','cleanup')),
  generation integer not null, attempt_id uuid, lease_until timestamptz,
  attempts integer not null default 0, due_at timestamptz not null default now(),
  retry_minimum_at timestamptz,
  status text not null default 'ready' check (status in ('ready','leased','done','failed')),
  primary key(submission_id, stage, generation)
);
create index jobs_eligible on upload_private.jobs(due_at) where status in ('ready','leased');
alter table upload_private.settings enable row level security;
alter table upload_private.submissions enable row level security;
alter table upload_private.objects enable row level security;
alter table upload_private.requests enable row level security;
alter table upload_private.jobs enable row level security;
grant all on all tables in schema upload_private to service_role;

-- Queues are durable wakeups; the job table provides authoritative lease/state.
-- Plain PostgreSQL test instances may lack these Supabase extensions. Production
-- readiness must check upload_health() before enabling admission.
do $$ begin
  if exists(select 1 from pg_available_extensions where name = 'pgmq') then
    create extension if not exists pgmq;
    perform pgmq.create('photo_upload');
    execute 'alter table pgmq.q_photo_upload enable row level security';
    execute 'alter table pgmq.a_photo_upload enable row level security';
  end if;
end $$;
create function upload_private.enqueue(sid uuid, job_stage text, gen integer)
returns void language plpgsql set search_path = '' as $$
begin
  insert into upload_private.jobs(submission_id, stage, generation)
    values(sid, job_stage, gen) on conflict do nothing;
  if to_regprocedure('pgmq.send(text,jsonb,integer)') is not null then
    perform pgmq.send('photo_upload', jsonb_build_object('submission_id',sid,'stage',job_stage,'generation',gen), 0);
  end if;
end $$;
create function upload_private.member(uid uuid, tid uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists(select 1 from public.trips t join public.group_members m on m.group_id=t.group_id
    where t.id=tid and m.user_id=uid);
$$;
create function upload_private.snapshot(s upload_private.submissions)
returns jsonb language sql immutable set search_path = '' as $$
  select to_jsonb(s) - 'request_id' - 'group_id' - 'original_approved' - 'candidate_approved';
$$;
create function upload_private.capacity(additional bigint)
returns boolean language plpgsql set search_path = '' as $$
declare used_bytes bigint; reservations bigint; cap bigint;
begin
  -- All admission/generation allocation takes the same global lock before a
  -- submission lock. Existing project buckets count toward this application cap.
  select budget_bytes into cap from upload_private.settings where singleton for update;
  select coalesce(sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::bigint else 0 end),0)
    into used_bytes from storage.objects o;
  select coalesce(sum(greatest(r.reservation_bytes - coalesce(case when o.metadata->>'size' ~ '^[0-9]+$'
    then (o.metadata->>'size')::bigint else 0 end,0),0)),0) into reservations
    from upload_private.objects r left join storage.objects o on o.bucket_id=r.bucket and o.name=r.path;
  return used_bytes + reservations + additional <= cap;
end $$;
create function upload_private.terminate(sid uuid, result text)
returns void language plpgsql set search_path = '' as $$
begin
  update upload_private.submissions set outcome=result, phase='complete', retry_at=null,
    pause_reason=null, cleanup_pending=true where id=sid and outcome is null;
  update upload_private.jobs set status='done', lease_until=null where submission_id=sid and stage<>'cleanup';
  perform upload_private.enqueue(sid,'cleanup',0);
end $$;
create function upload_private.retry_date(seconds double precision)
returns timestamptz language sql volatile set search_path = '' as $$
  -- A nonsensically large provider minimum fails closed without interval
  -- overflow; finite practical durations retain their full minimum.
  select case when seconds>=1000000000 then 'infinity'::timestamptz
    else now()+make_interval(secs=>greatest(seconds,0)) end;
$$;

-- Only the Edge service role can call this RPC. actor is obtained from an
-- authenticated Auth.getUser() call, never from a client supplied field.
create function public.upload_command(actor uuid, command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s upload_private.submissions; obj upload_private.objects; action text := command->>'action';
  sid uuid; rid uuid; gid uuid; gen integer; lat double precision; lon double precision;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  -- Consistent global-before-submission lock order prevents admission/cancel/
  -- worker completion deadlocks while preserving atomic capacity reservations.
  perform 1 from upload_private.settings where singleton for update;
  if action='list' then
    for s in select * from upload_private.submissions where user_id=actor and outcome is null and
      phase='original_upload' and pause_reason is distinct from 'technical' and expires_at>now() and
      upload_private.member(actor,trip_id) and exists(select 1 from upload_private.objects obj_entry
        join storage.objects storage_entry on storage_entry.bucket_id=obj_entry.bucket and storage_entry.name=obj_entry.path
        where obj_entry.submission_id=submissions.id and obj_entry.stage='original'
          and storage_entry.metadata->>'size' ~ '^[0-9]+$') for update loop
      update upload_private.submissions set phase='original_check' where id=s.id;
      perform upload_private.enqueue(s.id,'original',0);
    end loop;
    return jsonb_build_object('submissions',coalesce((select jsonb_agg(upload_private.snapshot(x) order by x.created_at)
      from upload_private.submissions x where x.user_id=actor and
      (x.outcome is null or x.cleanup_pending or x.created_at > now()-interval '7 days')), '[]'::jsonb));
  end if;
  sid := (command->>'id')::uuid;
  if action='admit' then
    rid := (command->>'request_id')::uuid;
    select * into s from upload_private.submissions where user_id=actor and request_id=rid for update;
    if s.id is not null then
      if s.id<>sid or s.trip_id<>(command->>'trip_id')::uuid or s.source_sha256 is distinct from command->>'source_sha256'
        or s.source_bytes is distinct from (command->>'source_bytes')::bigint then raise exception 'Request identity mismatch'; end if;
    else
      if not (select admission_enabled from upload_private.settings where singleton) then raise exception 'Uploads are paused'; end if;
      if not upload_private.member(actor,(command->>'trip_id')::uuid) then raise exception 'Trip access denied' using errcode='42501'; end if;
      if command->>'source_bytes' is null or command->>'source_sha256' is null or
        (command->>'source_bytes')::bigint not between 1 and 20971520 or command->>'source_sha256' !~ '^[a-f0-9]{64}$'
        or coalesce(length(command->>'filename'),0) not between 1 and 255 then raise exception 'Invalid original'; end if;
      if (select count(*) from upload_private.submissions where user_id=actor and outcome is null and pause_reason is distinct from 'technical')>=100 then raise exception 'Queue is full'; end if;
      if not upload_private.capacity(50331648) then raise exception 'Storage capacity is paused'; end if;
      select group_id into gid from public.trips where id=(command->>'trip_id')::uuid;
      insert into upload_private.submissions(id,request_id,user_id,trip_id,group_id,filename,source_sha256,source_bytes)
        values(sid,rid,actor,(command->>'trip_id')::uuid,gid,command->>'filename',command->>'source_sha256',(command->>'source_bytes')::bigint)
        returning * into s;
      insert into upload_private.objects(bucket,path,submission_id,stage,generation,expected_sha256,expected_bytes,reservation_bytes)
      values('photo-quarantine',actor||'/'||sid||'/original',sid,'original',0,s.source_sha256,s.source_bytes,20971520),
        ('photo-quarantine',actor||'/'||sid||'/candidate-1.webp',sid,'candidate',1,null,null,20971520),
        ('trip-photos',gid||'/'||s.trip_id||'/'||sid||'-1.webp',sid,'publication',1,null,null,8388608);
    end if;
  else
    select * into s from upload_private.submissions where id=sid and user_id=actor for update;
    if s.id is null and action='delete' then
      -- Existing gallery photos are grandfathered but now use trusted deletion.
      select p.trip_id,t.group_id,p.storage_path into s.trip_id,s.group_id,obj.path
        from public.photos p join public.trips t on t.id=p.trip_id where p.id=sid and p.uploaded_by=actor for update of p;
      if s.trip_id is null or not upload_private.member(actor,s.trip_id) then raise exception 'Photo access denied' using errcode='42501'; end if;
      insert into upload_private.submissions(id,request_id,user_id,trip_id,group_id,outcome,phase,cleanup_pending)
        values(sid,sid,actor,s.trip_id,s.group_id,'deleted','complete',true) returning * into s;
      insert into upload_private.objects(bucket,path,submission_id,stage,generation,reservation_bytes,retired)
        values('trip-photos',obj.path,sid,'publication',1,0,true);
      delete from public.photos where id=sid;
      perform upload_private.enqueue(sid,'cleanup',0);
    elsif s.id is null and action='cancel' then
      -- An offline tab can cancel its stable identity before admission was
      -- acknowledged. Persist that cancellation without authorizing any path
      -- or reserving capacity, so a delayed admission cannot resurrect it.
      if exists(select 1 from upload_private.submissions where id=sid) then
        raise exception 'Submission access denied' using errcode='42501';
      end if;
      if exists(select 1 from public.photos where id=sid) then
        raise exception 'Published photos require deletion';
      end if;
      insert into upload_private.submissions(id,request_id,user_id,trip_id,group_id,outcome,phase)
        values(sid,sid,actor,'00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','canceled','complete')
        returning * into s;
    elsif s.id is null then raise exception 'Submission access denied' using errcode='42501'; end if;
  end if;
  if s.outcome is null and s.expires_at<=now() then perform upload_private.terminate(sid,'expired'); end if;
  if s.outcome is null and not upload_private.member(actor,s.trip_id) then perform upload_private.terminate(sid,'access_revoked'); end if;
  select * into s from upload_private.submissions where id=sid;
  if action='reconcile' and s.outcome is null and s.phase='original_upload' and s.pause_reason is distinct from 'technical' and exists(
    select 1 from upload_private.objects obj_entry join storage.objects storage_entry
      on storage_entry.bucket_id=obj_entry.bucket and storage_entry.name=obj_entry.path
      where obj_entry.submission_id=sid and obj_entry.stage='original' and storage_entry.metadata->>'size' ~ '^[0-9]+$') then
    update upload_private.submissions set phase='original_check' where id=sid;
    perform upload_private.enqueue(sid,'original',0);
    select * into s from upload_private.submissions where id=sid;
  end if;
  if action='cancel' then
    if s.outcome='published' then raise exception 'Published photos require deletion'; end if;
    if s.outcome is null then perform upload_private.terminate(sid,'canceled'); end if;
  elsif action='delete' and s.outcome='published' then
    if not upload_private.member(actor,s.trip_id) then raise exception 'Trip access denied' using errcode='42501'; end if;
    delete from public.photos where id=sid and uploaded_by=actor;
    update upload_private.submissions set outcome='deleted',cleanup_pending=true where id=sid;
    update upload_private.objects set retired=true where submission_id=sid;
    insert into upload_private.jobs(submission_id,stage,generation) values(sid,'cleanup',0)
      on conflict(submission_id,stage,generation) do update set status='ready',due_at=now(),attempts=0;
  elsif action not in ('admit','list','reconcile','cancel','delete') then
    if s.outcome is not null then raise exception 'Submission is terminal'; end if;
    if s.pause_reason='technical' and action not in ('retry','recover','browser_failure') then raise exception 'Retry this stage first'; end if;
    if action='original_uploaded' and s.phase='original_upload' then
      if not exists(select 1 from storage.objects where bucket_id='photo-quarantine' and name=actor||'/'||sid||'/original') then raise exception 'Original missing'; end if;
      update upload_private.submissions set phase='original_check' where id=sid;
      perform upload_private.enqueue(sid,'original',0);
    elsif action='gps' then
      if not s.original_approved then raise exception 'Original is not approved'; end if;
      lat := (command->>'latitude')::double precision; lon := (command->>'longitude')::double precision;
      if not ((lat is null and lon is null) or (lat is not null and lon is not null and lat between -90 and 90 and lon between -180 and 180)) then raise exception 'Invalid GPS'; end if;
      if s.gps_acknowledged and (s.latitude is distinct from lat or s.longitude is distinct from lon) then raise exception 'GPS is already acknowledged'; end if;
      update upload_private.submissions set gps_acknowledged=true, latitude=lat,longitude=lon,
        phase=case when phase='gps' then 'processing' else phase end where id=sid;
    elsif action='candidate' then
      if not s.original_approved or not s.gps_acknowledged then raise exception 'Original and GPS approval required'; end if;
      rid := (command->>'request_id')::uuid;
      select generation into gen from upload_private.requests where submission_id=sid and request_id=rid;
      if gen is not null and gen<>s.generation then raise exception 'Candidate request is retired'; end if;
      if gen is null then
        if s.phase not in ('processing','candidate_upload') then raise exception 'Reconcile candidate before allocation'; end if;
        if exists(select 1 from upload_private.requests where submission_id=sid) then
          if not upload_private.capacity(29360128) then raise exception 'Storage capacity is paused'; end if;
          update upload_private.objects set retired=true where submission_id=sid and stage<>'original';
          update upload_private.jobs set status='done',lease_until=null where submission_id=sid and stage in ('candidate','publication');
          gen := s.generation+1;
          insert into upload_private.objects(bucket,path,submission_id,stage,generation,reservation_bytes)
            values('photo-quarantine',actor||'/'||sid||'/candidate-'||gen||'.webp',sid,'candidate',gen,20971520),
              ('trip-photos',s.group_id||'/'||s.trip_id||'/'||sid||'-'||gen||'.webp',sid,'publication',gen,8388608);
        else gen := s.generation; end if;
        insert into upload_private.requests values(sid,rid,gen);
        update upload_private.submissions set generation=gen,phase='candidate_upload',candidate_approved=false,
          error=null,pause_reason=null,attempts=0,retry_at=null where id=sid;
      end if;
      select * into obj from upload_private.objects where submission_id=sid and stage='candidate' and generation=gen;
      select * into s from upload_private.submissions where id=sid;
      return jsonb_build_object('submission',upload_private.snapshot(s),'target',jsonb_build_object('bucket',obj.bucket,'path',obj.path,'generation',gen));
    elsif action='candidate_uploaded' then
      gen := (command->>'generation')::integer;
      if gen<>s.generation then raise exception 'Candidate is retired'; end if;
      if command->>'sha256' is null or command->>'bytes' is null or command->>'sha256' !~ '^[a-f0-9]{64}$'
        or (command->>'bytes')::bigint not between 1 and 8388608 then raise exception 'Invalid candidate'; end if;
      select * into obj from upload_private.objects where submission_id=sid and stage='candidate' and generation=gen for update;
      if obj.expected_sha256 is not null and (obj.expected_sha256<>command->>'sha256' or obj.expected_bytes<>(command->>'bytes')::bigint) then raise exception 'Candidate identity mismatch'; end if;
      if not exists(select 1 from storage.objects where bucket_id=obj.bucket and name=obj.path) then raise exception 'Candidate missing'; end if;
      update upload_private.objects set expected_sha256=command->>'sha256', expected_bytes=(command->>'bytes')::bigint where bucket=obj.bucket and path=obj.path;
      if s.phase='candidate_upload' then
        update upload_private.submissions set phase='candidate_check' where id=sid;
        perform upload_private.enqueue(sid,'candidate',gen);
      end if;
    elsif action='recover' then
      if not s.original_approved then raise exception 'Original is not approved'; end if;
      return jsonb_build_object('submission',upload_private.snapshot(s),'recovery_path',actor||'/'||sid||'/original');
    elsif action='browser_failure' then
      if command->>'stage' not in ('original_upload','gps','processing','candidate_upload') then raise exception 'Invalid browser stage'; end if;
      if command->>'generation' is null then raise exception 'Browser failure generation is required'; end if;
      -- A stale tab may report an exhausted browser stage after the server has
      -- already advanced it. Such a report cannot pause or replace server work.
      if s.phase=command->>'stage' and s.generation=(command->>'generation')::integer then
        update upload_private.submissions set pause_reason='technical',error='This browser stage could not finish',
          retry_at=null,attempts=5 where id=sid;
      end if;
    elsif action='retry' then
      if s.pause_reason='quota' and s.retry_at>now() then raise exception 'Provider quota is paused'; end if;
      if s.pause_reason='technical' and (select count(*) from upload_private.submissions where user_id=actor and outcome is null
        and pause_reason is distinct from 'technical')>=100 then raise exception 'Queue is full'; end if;
      update upload_private.jobs set status='ready',attempts=0,due_at=greatest(now(),retry_minimum_at),lease_until=null,attempt_id=null
        where submission_id=sid and status in ('ready','failed') and stage<>'cleanup';
      update upload_private.submissions set pause_reason=null,error=null,retry_at=null,attempts=0 where id=sid;
    elsif action not in ('original_uploaded','candidate_uploaded') then raise exception 'Unknown upload action'; end if;
  end if;
  select * into s from upload_private.submissions where id=sid;
  if s.phase='original_upload' and s.outcome is null then
    return jsonb_build_object('submission',upload_private.snapshot(s),'target',jsonb_build_object('bucket','photo-quarantine','path',actor||'/'||sid||'/original','generation',0));
  end if;
  if s.phase='candidate_upload' and s.outcome is null then
    select * into obj from upload_private.objects where submission_id=sid and stage='candidate' and generation=s.generation;
    return jsonb_build_object('submission',upload_private.snapshot(s),'target',jsonb_build_object('bucket',obj.bucket,'path',obj.path,'generation',s.generation));
  end if;
  return jsonb_build_object('submission',upload_private.snapshot(s));
end $$;

-- Insert only the currently authorized immutable path. No UPDATE/upsert or
-- DELETE policy is granted. Client reads require original approval and access.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('photo-quarantine','photo-quarantine',false,20971520,array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
  on conflict(id) do update set public=false,file_size_limit=20971520,
    allowed_mime_types=excluded.allowed_mime_types;
create function public.upload_storage_allowed(object_name text, reading boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from upload_private.objects o join upload_private.submissions s on s.id=o.submission_id
    where o.bucket='photo-quarantine' and o.path=object_name and not o.retired and o.deleted_at is null
      and s.user_id=(select auth.uid()) and s.outcome is null and s.expires_at>now()
      and upload_private.member((select auth.uid()),s.trip_id)
      and case when reading then o.stage='original' and s.original_approved
        else s.pause_reason is distinct from 'technical' and ((o.stage='original' and s.phase='original_upload') or
          (o.stage='candidate' and o.generation=s.generation and s.phase='candidate_upload')) end);
$$;
revoke all on function public.upload_storage_allowed(text,boolean) from public,anon;
grant execute on function public.upload_storage_allowed(text,boolean) to authenticated;
create policy "upload immutable quarantine" on storage.objects for insert to authenticated
  with check(bucket_id='photo-quarantine' and owner_id=(select auth.uid())::text and public.upload_storage_allowed(name,false));
create policy "recover approved originals" on storage.objects for select to authenticated
  using(bucket_id='photo-quarantine' and public.upload_storage_allowed(name,true));
drop policy "members add uploaded photos" on public.photos;
drop policy "member uploaders delete photos" on public.photos;
drop policy "members upload trip files" on storage.objects;
drop policy "member uploaders delete trip files" on storage.objects;
create or replace function public.can_access_trip_photo(object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.photos p join public.trips t on t.id=p.trip_id
    where p.storage_path=object_name and public.is_group_member(t.group_id));
$$;

revoke all on function public.upload_command(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.upload_command(uuid,jsonb) to service_role;
revoke all on all functions in schema upload_private from public,anon,authenticated;
grant execute on all functions in schema upload_private to service_role;

create function public.upload_claim()
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
  if to_regprocedure('pgmq.read(text,integer,integer)') is not null then
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

create function public.upload_queue_reconcile()
returns void language plpgsql security definer set search_path = '' as $$
declare delivery record;
begin
  if to_regprocedure('pgmq.read(text,integer,integer)') is not null then
    for delivery in select * from pgmq.read('photo_upload',120,100) loop
      if exists(select 1 from upload_private.jobs where submission_id=(delivery.message->>'submission_id')::uuid
        and stage=delivery.message->>'stage' and generation=(delivery.message->>'generation')::integer) then
        perform pgmq.delete('photo_upload',delivery.msg_id);
      end if;
    end loop;
  end if;
end $$;

create function public.upload_finish(result jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare sid uuid := (result->>'submission_id')::uuid; stage_name text := result->>'stage';
  gen integer := (result->>'generation')::integer; token uuid := (result->>'attempt_id')::uuid;
  verdict text := result->>'outcome'; s upload_private.submissions; j upload_private.jobs; o upload_private.objects;
  delay_seconds double precision; removed jsonb;
begin
  perform 1 from upload_private.settings where singleton for update;
  select * into s from upload_private.submissions where id=sid for update;
  select * into j from upload_private.jobs where submission_id=sid and stage=stage_name and generation=gen for update;
  if j.status is distinct from 'leased' or j.attempt_id is distinct from token or j.lease_until<=now() then return false; end if;
  if stage_name in ('original','candidate') then
    update upload_private.settings set provider_lease=null,provider_until=null,provider_ready_at=now()+interval '1 second'
      where singleton and provider_lease=token;
  end if;
  if stage_name<>'cleanup' then
    if s.outcome is not null or (stage_name<>'original' and gen<>s.generation) then return false; end if;
    if s.expires_at<=now() or not upload_private.member(s.user_id,s.trip_id) then
      perform upload_private.terminate(sid,case when s.expires_at<=now() then 'expired' else 'access_revoked' end); return false;
    end if;
  end if;
  if stage_name='cleanup' then
    -- Acknowledged deletions are per path; a retry never loses prior progress.
    for removed in select * from jsonb_array_elements(coalesce(result->'removed','[]'::jsonb)) loop
      update upload_private.objects set deleted_at=now(),reservation_bytes=0,verified_bytes=null,
        expected_sha256=null,expected_bytes=null where submission_id=sid and bucket=removed->>'bucket' and path=removed->>'path'
        and (retired or s.outcome is not null and (s.outcome<>'published' or stage<>'publication'));
    end loop;
    if not exists(select 1 from upload_private.objects where submission_id=sid and deleted_at is null and
      (retired or s.outcome is not null and (s.outcome<>'published' or stage<>'publication'))) then
      update upload_private.submissions set cleanup_pending=false,filename=case when outcome is not null then null else filename end,
        source_sha256=case when outcome is not null then null else source_sha256 end,source_bytes=case when outcome is not null then null else source_bytes end,
        latitude=case when outcome is not null then null else latitude end,longitude=case when outcome is not null then null else longitude end,
        error=case when outcome is not null then null else error end where id=sid;
      update upload_private.jobs set status='done',lease_until=null where submission_id=sid and stage=stage_name and generation=gen;
      return true;
    end if;
    if verdict='cleaned' then
      -- Large tombstones are deleted in bounded batches. Successful progress
      -- does not consume a technical-failure retry cycle.
      update upload_private.jobs set status='ready',attempts=greatest(attempts-1,0),due_at=now(),lease_until=null
        where submission_id=sid and stage=stage_name and generation=gen;
      return true;
    end if;
    verdict := 'technical';
  end if;
  if verdict in ('technical','quota') then
    delay_seconds := greatest(case when verdict='quota' then 3600 else power(2,j.attempts)+random() end,
      coalesce((result->>'retry_after_seconds')::double precision,0));
    if verdict='quota' then
      update upload_private.settings set provider_ready_at=upload_private.retry_date(delay_seconds) where singleton;
    end if;
    update upload_private.jobs set status=case when verdict='technical' and j.attempts>=5 then 'failed' else 'ready' end,
      attempts=case when verdict='quota' then greatest(attempts-1,0) else attempts end,
      lease_until=null,retry_minimum_at=case when verdict='quota' then upload_private.retry_date(delay_seconds)
        when coalesce((result->>'retry_after_seconds')::double precision,0)>0 then upload_private.retry_date((result->>'retry_after_seconds')::double precision) else null end,
      due_at=upload_private.retry_date(case when stage_name='cleanup' and j.attempts>=5 then 86400 else delay_seconds end)
      where submission_id=sid and stage=stage_name and generation=gen;
    if stage_name<>'cleanup' then
      update upload_private.submissions set attempts=case when verdict='quota' then greatest(j.attempts-1,0) else j.attempts end,
        error=case when verdict='quota' then 'Moderation free allowance is paused' else 'This stage could not finish' end,
        retry_at=case when verdict='technical' and j.attempts>=5 then null else upload_private.retry_date(delay_seconds) end,
        pause_reason=case when verdict='quota' then 'quota' when j.attempts>=5 then 'technical' else null end where id=sid;
    end if;
    return true;
  end if;
  if stage_name in ('original','candidate') then
    select * into o from upload_private.objects where submission_id=sid and stage=stage_name and generation=gen for update;
    if verdict='approved' and (result->>'sha256' is distinct from o.expected_sha256 or
      (result->>'bytes')::bigint is distinct from o.expected_bytes or o.expected_bytes>case when stage_name='candidate' then 8388608 else 20971520 end) then
      verdict := 'invalid';
    end if;
    if verdict in ('invalid','uncertain','rejected') then
      perform upload_private.terminate(sid,case when verdict='invalid' then 'invalid' else 'rejected' end); return true;
    end if;
    if verdict<>'approved' then raise exception 'Unknown classification result'; end if;
    update upload_private.objects set verified_bytes=o.expected_bytes,reservation_bytes=o.expected_bytes where bucket=o.bucket and path=o.path;
    update upload_private.submissions set original_approved=case when stage_name='original' then true else original_approved end,
      candidate_approved=case when stage_name='candidate' then true else candidate_approved end,
      phase=case when stage_name='original' then 'gps' else 'publication' end,attempts=0,retry_at=null,error=null,pause_reason=null where id=sid;
    if stage_name='candidate' then perform upload_private.enqueue(sid,'publication',gen); end if;
  elsif stage_name='publication' then
    select * into o from upload_private.objects where submission_id=sid and stage='publication' and generation=gen for update;
    if verdict<>'published' or not s.original_approved or not s.candidate_approved or not s.gps_acknowledged
      or not exists(select 1 from storage.objects where bucket_id=o.bucket and name=o.path) then raise exception 'Publication gates incomplete'; end if;
    -- Lock the membership and trip until commit as well as the submission. This
    -- serializes a concurrent revocation/deletion with the final authorization.
    perform 1 from public.trips where id=s.trip_id for key share;
    perform 1 from public.group_members where group_id=s.group_id and user_id=s.user_id for key share;
    if not upload_private.member(s.user_id,s.trip_id) then perform upload_private.terminate(sid,'access_revoked'); return false; end if;
    insert into public.photos(id,trip_id,uploaded_by,storage_path,latitude,longitude)
      values(s.id,s.trip_id,s.user_id,o.path,s.latitude,s.longitude);
    update upload_private.objects set reservation_bytes=coalesce((select verified_bytes from upload_private.objects
      where submission_id=sid and stage='candidate' and generation=gen),8388608) where bucket=o.bucket and path=o.path;
    update upload_private.submissions set outcome='published',phase='complete',cleanup_pending=true,
      attempts=0,retry_at=null,error=null,pause_reason=null where id=sid;
    perform upload_private.enqueue(sid,'cleanup',0);
  else raise exception 'Unknown job stage'; end if;
  update upload_private.jobs set status='done',lease_until=null where submission_id=sid and stage=stage_name and generation=gen;
  return true;
end $$;

create function public.upload_health()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare scheduled boolean := false;
begin
  if to_regclass('cron.job') is not null then
    execute 'select exists(select 1 from cron.job where jobname=''photo-upload-worker'' and active)' into scheduled;
  end if;
  return jsonb_build_object('admission_enabled',(select admission_enabled from upload_private.settings where singleton),
    'queues',to_regprocedure('pgmq.read(text,integer,integer)') is not null,
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
revoke all on function public.upload_claim(),public.upload_finish(jsonb),public.upload_queue_reconcile(),public.upload_health() from public,anon,authenticated;
grant execute on function public.upload_claim(),public.upload_finish(jsonb),public.upload_queue_reconcile(),public.upload_health() to service_role;

-- Configure Vault secrets photo_upload_worker_url and photo_upload_worker_token
-- before enabling admission. The latter is a dedicated bearer token checked by
-- the worker; it is never placed into the browser or stored in queue messages.
do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then create extension if not exists pg_cron; end if;
  if exists(select 1 from pg_available_extensions where name='pg_net') then create extension if not exists pg_net with schema extensions; end if;
end $$;
create function public.upload_schedule()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if to_regnamespace('cron') is null or to_regnamespace('vault') is null or to_regnamespace('net') is null then
    raise exception 'Cron, Vault and pg_net are required';
  end if;
  perform cron.schedule('photo-upload-worker','* * * * *', $schedule$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='photo_upload_worker_url'),
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||
        (select decrypted_secret from vault.decrypted_secrets where name='photo_upload_worker_token')),
      body := '{}'::jsonb, timeout_milliseconds := 95000);
  $schedule$);
end $$;
revoke all on function public.upload_schedule() from public,anon,authenticated;
grant execute on function public.upload_schedule() to service_role;

create function public.upload_retry_cleanup(sid uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from upload_private.settings where singleton for update;
  perform 1 from upload_private.submissions where id=sid for update;
  update upload_private.jobs set status='ready',due_at=now(),attempts=0,attempt_id=null,lease_until=null
    where submission_id=sid and stage='cleanup';
end $$;
revoke all on function public.upload_retry_cleanup(uuid) from public,anon,authenticated;
grant execute on function public.upload_retry_cleanup(uuid) to service_role;
