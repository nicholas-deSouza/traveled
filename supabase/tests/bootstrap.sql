-- Only for an empty, disposable local PostgreSQL database, never production.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
-- Real Supabase provides this role for SQL Auth hooks; bare Postgres does not.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end;
$$;
create schema auth;
create schema storage;
create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner_id text, metadata jsonb default '{}', unique(bucket_id, name));
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql immutable as $$
  select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1)-1];
$$;
grant usage on schema public, auth, storage to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema public, auth, storage to service_role;
grant all on storage.objects, storage.buckets to service_role;
