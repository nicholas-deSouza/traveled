-- Deployment pauses use an admission-specific revision. The worker updates
-- this singleton too, so the row's xmin cannot identify an operator pause.
alter table upload_private.settings
  add column admission_revision bigint not null default 0 check (admission_revision >= 0);

create function upload_private.bump_admission_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- UPDATE OF fires even for false -> false: a deliberate operator pause must
  -- invalidate the deployment's right to resume an already-paused switch.
  new.admission_revision := old.admission_revision + 1;
  return new;
end;
$$;
revoke all on function upload_private.bump_admission_revision() from public, anon, authenticated;

create trigger photo_upload_admission_revision
before update of admission_enabled on upload_private.settings
for each row execute function upload_private.bump_admission_revision();
