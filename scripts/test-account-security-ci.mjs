import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const job = workflow.match(/^ {2}upload-database:\n([\s\S]*?)(?=^ {2}[\w-]+:\n|(?![\s\S]))/m)?.[1];
assert.ok(job, 'upload-database job must exist');
const block = job.match(/ {6}- name: Apply schema and run SQL\/Storage assertions\n {8}run: \|\n((?: {10}[^\n]*\n)+)/)?.[1];
assert.ok(block, 'database assertion shell block must exist');
const script = block.replace(/^ {10}/gm, '');
const suites = ['groups', 'trip_colors', 'account_security', 'photo_upload', 'photo_upload_pgmq'];

// Execute the actual workflow shell block with command stubs. Empty PATH and
// a clean environment prevent access to services, credentials or real tools.
function runGate(failure = '') {
  const stubs = `
failure="$1"
supabase() { printf '{}'; }
jq() { printf 'fixture-value'; }
node() {
  printf 'node\\t%s\\n' "$*" >&2
  if [[ "$1" == scripts/check-account-security.mjs && "$failure" == account-api ]]; then return 6; fi
  if [[ "$1" == scripts/prepare-fresh-schema.mjs ]]; then
    [[ "$failure" != schema ]] || return 8
    printf 'select 1;\\n'
  fi
}
psql() {
  if [[ "$*" != *' -f '* && "$*" != *' -c '* ]]; then
    while IFS= read -r line; do :; done
  fi
  printf 'psql\\t%s\\n' "$*" >&2
  if [[ "$failure" == schema-apply && "$*" != *' -f '* && "$*" != *' -c '* ]]; then
    return 9
  fi
  if [[ -n "$failure" && "$*" == *"-f supabase/tests/$failure.sql"* ]]; then
    return 7
  fi
}
`;
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', stubs + script, 'database-ci-test', failure], {
    encoding: 'utf8', env: { PATH: '', RUNNER_TEMP: '/unused-fixture' },
  });
  assert.ifError(result.error);
  return { status: result.status, calls: result.stderr.trim().split('\n') };
}

test('database CI applies fresh schema, executes all SQL suites, then runs Storage checks', () => {
  const { status, calls } = runGate();
  assert.equal(status, 0);
  const schema = calls.indexOf('psql\tfixture-value -v ON_ERROR_STOP=1');
  assert.ok(schema >= 0, 'fresh schema must be applied with SQL errors fatal');
  assert.ok(calls.includes('node\tscripts/prepare-fresh-schema.mjs'));
  let previous = schema;
  for (const suite of suites) {
    const command = `psql\tfixture-value -v ON_ERROR_STOP=1 -f supabase/tests/${suite}.sql`;
    assert.equal(calls.filter(call => call === command).length, 1, `${suite} must execute once with SQL errors fatal`);
    const current = calls.indexOf(command);
    assert.ok(current > previous, `${suite} must execute after schema and preceding suites`);
    previous = current;
  }
  assert.ok(calls.indexOf('node\tscripts/check-upload-storage.mjs') > previous, 'Storage checks must follow all SQL suites');
  const api = calls.indexOf('node\tscripts/check-account-security.mjs');
  assert.ok(api > previous && api < calls.indexOf('node\tscripts/check-upload-storage.mjs'), 'account HTTP checks must follow SQL and precede Storage');
});

test('account HTTP failure stops admission changes and Storage checks', () => {
  const { status, calls } = runGate('account-api');
  assert.equal(status, 6);
  assert.ok(!calls.some(call => call.includes('admission_enabled=true')));
  assert.ok(!calls.includes('node\tscripts/check-upload-storage.mjs'));
});

test('each SQL suite failure stops subsequent suites and Storage checks', () => {
  for (const [index, suite] of suites.entries()) {
    const { status, calls } = runGate(suite);
    assert.equal(status, 7, `${suite} failure must fail CI`);
    for (const later of suites.slice(index + 1)) {
      assert.ok(!calls.some(call => call.includes(`supabase/tests/${later}.sql`)), `${later} must not run after ${suite} fails`);
    }
    assert.ok(!calls.includes('node\tscripts/check-upload-storage.mjs'), 'Storage must not run after SQL failure');
  }
});

test('fresh schema generation failure fails the pipeline before SQL suites or Storage', () => {
  const { status, calls } = runGate('schema');
  assert.equal(status, 8, 'schema generator failure must propagate through the psql pipeline');
  assert.ok(!calls.some(call => call.includes(' -f supabase/tests/')));
  assert.ok(!calls.includes('node\tscripts/check-upload-storage.mjs'));
});

test('fresh schema SQL failure stops SQL suites and Storage checks', () => {
  const { status, calls } = runGate('schema-apply');
  assert.equal(status, 9, 'schema SQL failure must fail CI');
  assert.ok(!calls.some(call => call.includes(' -f supabase/tests/')));
  assert.ok(!calls.includes('node\tscripts/check-upload-storage.mjs'));
});

test('revoked-member Storage deletion checks scope the statement guard override without bypassing RLS', () => {
  const sql = readFileSync(new URL('../supabase/tests/groups.sql', import.meta.url), 'utf8');
  const override = sql.indexOf("set local storage.allow_delete_query = 'true';");
  const restore = sql.indexOf("set local storage.allow_delete_query = 'false';", override);
  assert.ok(override > 0 && restore > override);
  assert.match(sql.slice(override, restore), /^set local storage\.allow_delete_query = 'true';\s*delete\s+from\s+storage\.objects;\s*$/);
  assert.equal(sql.match(/set local storage\.allow_delete_query = 'true';/g)?.length, 1);
  assert.equal(sql.match(/pg_temp\.assert_storage_delete_guard\(\)/g)?.length, 3, 'definition and before/after checks');
  assert.match(sql, /sqlerrm = 'Direct deletion from storage tables is not allowed\. Use the Storage API instead\.'/);
  assert.doesNotMatch(sql, /disable\s+(?:row level security|trigger)|session_replication_role/i);
  assert.ok(sql.indexOf('removed uploader cannot delete files', restore) > restore);
  assert.match(sql, /rollback;\s*\\echo 'All group security assertions passed\.'\s*$/i);
});
