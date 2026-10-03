import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createDiagnostics } from './script-diagnostics.mjs';
import { freshSchema } from './prepare-fresh-schema.mjs';
import { checkComponentTests } from './check-component-tests.mjs';
import { storageConfiguration, validStoragePayload, runStorageChecks } from './check-upload-storage.mjs';
import { validReviewReport } from './review-staged.mjs';
import { buildArtifact } from '../infrastructure/photo-classifier/build-artifact.mjs';

const quiet = createDiagnostics('test', () => {});
const uuid = '11111111-1111-4111-8111-111111111111';

test('fresh schema preserves transactional stdout and logs only to stderr', () => {
  const { stdout, stderr, status } = spawnSync(process.execPath, [new URL('./prepare-fresh-schema.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(status, 0);
  assert.ok(stdout.startsWith('begin;\n'));
  assert.ok(stdout.endsWith('commit;\n'));
  assert.ok(!stdout.includes('"event"'));
  const logs = stderr.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(logs.at(-1).event, 'completed');
  assert.equal(logs.find(log => log.stage === 'assemble-schema' && log.event === 'completed').count > 0, true);
});

test('CI event failures explain the fallback without corrupting GitHub outputs or echoing event data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'traveled-ci-diagnostics-'));
  const event = join(directory, 'event.json'), output = join(directory, 'output.txt');
  writeFileSync(event, '{"secret":"private-event-data"');
  const result = spawnSync(process.execPath, [new URL('./ci-upload-changes.mjs', import.meta.url).pathname], {
    encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'upload_database=true\nclassifier_artifact=true\n');
  assert.ok(result.stderr.includes('invalid_json'));
  assert.ok(!result.stderr.includes('private-event-data'));
});

test('schema preparation rejects missing and empty migrations with stage-specific errors', () => {
  const directory = mkdtempSync(join(tmpdir(), 'traveled-schema-diagnostics-'));
  const url = pathToFileURL(directory + '/');
  assert.throws(() => freshSchema(url, quiet), error => error.stage === 'assemble-schema' && error.code === 'missing_initial_migration');
  writeFileSync(join(directory, '0001_initial_schema.sql'), '');
  assert.throws(() => freshSchema(url, quiet), error => error.code === 'empty_migration');
  writeFileSync(join(directory, '0001_initial_schema.sql'), 'select owner_id = auth.uid();');
  writeFileSync(join(directory, '0002_more.sql'), 'select 2;');
  assert.equal(freshSchema(url, quiet), 'begin;\nselect owner_id = auth.uid()::text;\nselect 2;\ncommit;\n');
});

test('component pairing checks still exclude the entry point and test helpers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'traveled-component-diagnostics-'));
  mkdirSync(join(directory, 'test'));
  writeFileSync(join(directory, 'main.tsx'), '');
  writeFileSync(join(directory, 'test', 'helper.tsx'), '');
  writeFileSync(join(directory, 'Page.tsx'), '');
  assert.throws(() => checkComponentTests(directory, quiet), error => error.code === 'missing_component_tests' && error.details.count === 1);
  writeFileSync(join(directory, 'Page.test.tsx'), '');
  assert.equal(checkComponentTests(directory, quiet), 1);
});

test('Storage gates reject unsafe configuration before any request and reject malformed signup before mutations', async () => {
  const env = { UPLOAD_TEST_URL: 'http://127.0.0.1:54321', UPLOAD_TEST_SERVICE_KEY: 'private-service', UPLOAD_TEST_ANON_KEY: 'local-anon' };
  let calls = 0;
  await assert.rejects(runStorageChecks({ ...env, UPLOAD_TEST_URL: 'https://production.supabase.co' }, () => { calls++; }, quiet), error => error.code === 'nonlocal_origin');
  assert.equal(calls, 0);
  for (const url of ['bad', 'http://user:password@localhost', 'http://localhost?token=private']) assert.throws(() => storageConfiguration({ ...env, UPLOAD_TEST_URL: url }));
  await assert.rejects(runStorageChecks(env, async () => { calls++; return Response.json({ access_token: 'private-token', user: null }); }, quiet), error => error.code === 'invalid_shape' && !error.message.includes('private-token'));
  assert.equal(calls, 1);
});

test('Storage response contracts validate target, job and completion fields before use', () => {
  const path = '/rest/v1/rpc/upload_claim';
  assert.equal(validStoragePayload(path, null), true);
  const job = { submission_id: uuid, attempt_id: uuid, generation: 0, stage: 'original', bucket: 'photo-quarantine', path: 'fixture', expected_bytes: 1, expected_sha256: 'a'.repeat(64) };
  assert.equal(validStoragePayload(path, job), true);
  for (const changes of [{ generation: '0' }, { expected_bytes: null }, { stage: 'unexpected' }, { objects: null, stage: 'cleanup' }]) assert.equal(validStoragePayload(path, { ...job, ...changes }), false);
  assert.equal(validStoragePayload('/rest/v1/rpc/upload_finish', false), false);
  assert.equal(validStoragePayload('/rest/v1/rpc/upload_finish', true), true);
  assert.equal(validStoragePayload('/rest/v1/rpc/upload_command', { submission: { id: uuid } }, { command: { action: 'candidate' } }), false);
});

test('review reports reject missing and malformed findings before displaying results', () => {
  assert.equal(validReviewReport({ findings: [], summary: 'Passed' }), true);
  for (const value of [null, [], {}, { findings: [null], summary: '' }, { findings: [{ severity: 'P9', location: '', title: '', explanation: '' }], summary: '' }]) assert.equal(validReviewReport(value), false);
});

test('artifact packaging validates its runtime and output before staging files or running commands', async () => {
  let calls = 0;
  const execute = () => { calls++; };
  await assert.rejects(buildArtifact('/unused', quiet, { platform: 'darwin', arch: 'x64', versions: { node: '24.0.0' } }, execute), error => error.code === 'unsupported_runtime');
  await assert.rejects(buildArtifact('', quiet, { platform: 'linux', arch: 'x64', versions: { node: '24.0.0' } }, execute), error => error.code === 'missing_output');
  assert.equal(calls, 0);
});
