import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jobsForPaths, selectUploadJobs } from './ci-upload-changes.mjs';

const both = { upload_database: true, classifier_artifact: true };
const neither = { upload_database: false, classifier_artifact: false };
const base = 'a'.repeat(40), head = 'b'.repeat(40);

test('documentation and unrelated UI changes skip expensive upload environments', () => {
  assert.deepEqual(jobsForPaths(['docs/photo-upload-runbook.md', 'src/pages/LoginPage.tsx']), neither);
  assert.deepEqual(jobsForPaths(['infrastructure/photo-classifier/README.md']), neither);
  assert.deepEqual(jobsForPaths([]), neither);
});

test('database, Storage and client upload changes select only the database gate', () => {
  for (const path of ['supabase/migrations/new.sql', 'supabase/config.toml', 'supabase/functions/photo-upload/handler.ts',
    'supabase/tests/photo_upload.sql', 'scripts/check-upload-storage.mjs', 'scripts/prepare-fresh-schema.mjs',
    'scripts/test-upload-server.mjs', 'src/lib/groups.ts', 'src/lib/uploads/photoUploadApi.ts']) {
    assert.deepEqual(jobsForPaths([path]), { upload_database: true, classifier_artifact: false }, path);
  }
});

test('classifier code, fixtures and lockfile select its Linux artifact gate', () => {
  for (const path of ['infrastructure/photo-classifier/src/images.ts', 'infrastructure/photo-classifier/package-lock.json',
    'infrastructure/photo-classifier/template.yaml', 'infrastructure/photo-classifier/test/fixture.heic']) {
    assert.deepEqual(jobsForPaths([path]), { upload_database: false, classifier_artifact: true }, path);
  }
});

test('shared contracts, dependency and routing configuration select both gates', () => {
  for (const path of ['src/lib/photoUploadContract.ts', 'package.json', 'pnpm-lock.yaml', '.github/workflows/ci.yml',
    'scripts/ci-upload-changes.mjs', 'scripts/test-ci-upload-changes.mjs', '.github/workflows/deploy-photo-upload.yml',
    'scripts/deploy-photo-upload.mjs', 'scripts/test-deploy-photo-upload.mjs']) assert.deepEqual(jobsForPaths([path]), both, path);
  assert.deepEqual(jobsForPaths(['supabase/tests/photo_upload.sql', 'infrastructure/photo-classifier/src/images.ts']), both);
});

test('PR diff includes earlier commits and both paths of renames', () => {
  const jobs = selectUploadJobs('pull_request', { pull_request: { base: { sha: base }, head: { sha: head } } }, args => {
    assert.deepEqual(args, ['diff', '--name-only', '-z', '--no-renames', `${base}...${head}`, '--']);
    return Buffer.from('supabase/tests/old fixture.sql\0docs/new fixture.sql\0');
  });
  assert.deepEqual(jobs, { upload_database: true, classifier_artifact: false });
});

test('default-branch push compares before/after and handles unusual file names', () => {
  const jobs = selectUploadJobs('push', { before: base, after: head }, args => {
    assert.equal(args[4], `${base}..${head}`);
    return Buffer.from('docs/file with\nnewline.md\0infrastructure/photo-classifier/src/images.ts\0');
  });
  assert.deepEqual(jobs, { upload_database: false, classifier_artifact: true });
});

test('manual, new-branch, invalid and unavailable-history runs keep both gates enabled', () => {
  const unexpectedDiff = () => { throw Error('Should not need a diff'); };
  assert.deepEqual(selectUploadJobs('workflow_dispatch', {}, unexpectedDiff), both);
  assert.deepEqual(selectUploadJobs('push', { before: '0'.repeat(40), after: head }, unexpectedDiff), both);
  assert.deepEqual(selectUploadJobs('push', { before: '--bad', after: head }, unexpectedDiff), both);
  assert.deepEqual(selectUploadJobs('pull_request', {}, unexpectedDiff), both);
  assert.deepEqual(selectUploadJobs('push', { before: base, after: head }, () => { throw Error('Missing commit'); }), both);
});
