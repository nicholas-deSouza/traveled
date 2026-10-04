import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../supabase/tests/account_security.sql', import.meta.url), 'utf8');
const hosted = readFileSync(new URL('../supabase/tests/account_security_hosted.sql', import.meta.url), 'utf8');

test('SQL Editor adapter has no psql commands, substitutions or transaction control', () => {
  assert.doesNotMatch(hosted, /^\s*\\/m);
  assert.doesNotMatch(hosted, /\\gset|:'\w+'/);
  // BEGIN/END inside PL/pgSQL are necessary; standalone transaction statements
  // would break the caller-owned migration + assertions + ROLLBACK envelope.
  assert.doesNotMatch(hosted, /^(?:begin|start transaction|commit|rollback);$/im);
  assert.match(hosted, /on commit drop;/);
  assert.match(hosted, /reset role;\nselect 'account_security SQL assertions passed/);
});

test('SQL Editor adapter preserves every original assertion and fixture operation', () => {
  let expected = source.slice(source.indexOf('insert into auth.users')).replace(/rollback;\s*$/, '').trim();
  expected = expected.replace("select public.create_group('Account security first') as first_group \\gset", "update pg_temp.account_security_fixture set first_group = public.create_group('Account security first') where singleton;");
  expected = expected.replace("select public.create_group('Account security second') as second_group \\gset", "update pg_temp.account_security_fixture set second_group = public.create_group('Account security second') where singleton;");
  expected = expected.replace("select token as invitation from public.create_group_invitation(:'first_group') \\gset", () => `-- Repository RPC returns TABLE(token text, expires_at timestamptz), not a scalar
-- token or JSON object. Qualify the correlated fixture and returned token.
update pg_temp.account_security_fixture as fixture set invitation =
  (select created.token from public.create_group_invitation(fixture.first_group) as created)
  where fixture.singleton;
select pg_temp.assert((select invitation ~ '^[a-f0-9]{64}$' from pg_temp.account_security_fixture where singleton), 'invitation RPC returns one usable text token');`);
  for (const name of ['first_group', 'second_group', 'invitation']) {
    expected = expected.replaceAll(`:'${name}'`, `(select ${name} from pg_temp.account_security_fixture where singleton)`);
  }
  const actual = hosted.slice(hosted.indexOf('insert into auth.users'))
    .replace(/select 'account_security SQL assertions passed[^\n]*\n?$/, '').trim();
  assert.equal(actual, expected);
});

test('both SQL suites use owner execution and ACL evidence without Auth impersonation', () => {
  for (const sql of [source, hosted]) {
    assert.doesNotMatch(sql, /set\s+(?:local\s+)?role\s+supabase_auth_admin/i);
    assert.match(sql, /-- Still the function owner/);
    const hookChecks = sql.slice(sql.indexOf('-- Still the function owner'));
    assert.doesNotMatch(hookChecks, /^set\s+(?:local\s+)?role/im);
    assert.match(sql, /has_function_privilege\('supabase_auth_admin', 'auth_private\.before_user_created\(jsonb\)', 'EXECUTE'\)/);
    assert.match(sql, /has_schema_privilege\('supabase_auth_admin', 'auth_private', 'USAGE'\)/);
    assert.doesNotMatch(sql, /grant\s+supabase_auth_admin\s+to|alter\s+role/i);
  }
  assert.doesNotMatch(hosted, /supabase_migrations|schema_migrations/);
});

test('invitation adapter selects the repository RPC table token and validates its shape', () => {
  const migration = readFileSync(new URL('../supabase/migrations/0002_groups_and_invitations.sql', import.meta.url), 'utf8');
  assert.match(migration, /create function public\.create_group_invitation\(target_group_id uuid\)\nreturns table \(token text, expires_at timestamptz\)/);
  assert.match(hosted, /select created\.token from public\.create_group_invitation\(fixture\.first_group\) as created/);
  assert.match(hosted, /invitation ~ '\^\[a-f0-9\]\{64\}\$'/);
});

test('all reserved identities are collision-guarded before any fixture insertion', () => {
  const guard = hosted.slice(hosted.indexOf('-- Abort before'), hosted.indexOf('create temporary table'));
  assert.match(guard, /do \$\$\nbegin/);
  assert.match(guard, /end;\n\$\$;/);
  assert.match(guard, /from auth\.users/);
  assert.match(guard, /from public\.profiles/);
  assert.match(guard, /raise exception 'FAILED: account security fixture UUID collision/);
  const ids = [...new Set(source.match(/00000000-0000-0000-0000-00000000010[1-4]/g))];
  assert.equal(ids.length, 4);
  for (const id of ids) assert.equal(guard.split(id).length - 1, 2);
  assert.ok(hosted.indexOf('fixture UUID collision') < hosted.indexOf('insert into auth.users'));
  assert.doesNotMatch(hosted, /on conflict|truncate|delete from (?:auth\.users|public\.profiles)/i);
});

test('SQL block dollar quotes are paired and no lone delimiter was introduced', () => {
  assert.doesNotMatch(hosted, /^\s*(?:do )?\$(?:;)?$/m);
  const delimiters = hosted.match(/\$\$|\$[a-zA-Z_][a-zA-Z_0-9]*\$/g) ?? [];
  assert.ok(delimiters.length > 0);
  for (let index = 0; index < delimiters.length; index += 2) {
    assert.equal(delimiters[index], delimiters[index + 1]);
  }
});

test('temporary fixture table grants only reads and three update columns to authenticated', () => {
  const grants = hosted.match(/^grant .*;$/gm);
  assert.deepEqual(grants, [
    'grant select on pg_temp.account_security_fixture to authenticated;',
    'grant update (first_group, second_group, invitation) on pg_temp.account_security_fixture to authenticated;',
  ]);
  assert.match(hosted, /revoke all on pg_temp\.account_security_fixture from public, anon, authenticated, service_role, supabase_auth_admin;/);
  assert.match(hosted, /select set_config\('request\.jwt\.claims', '\{\}', true\);/);
});
