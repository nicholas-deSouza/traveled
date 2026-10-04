import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiagnostics, fail, isRecord, readJSONFile, runScript } from './script-diagnostics.mjs';

const allJobs = () => ({ upload_database: true, classifier_artifact: true });
const sharedFiles = new Set([
  '.github/workflows/ci.yml',
  '.github/workflows/deploy-photo-upload.yml',
  'scripts/deploy-photo-upload.mjs',
  'scripts/test-deploy-photo-upload.mjs',
  'scripts/script-diagnostics.mjs',
  'scripts/test-script-diagnostics.mjs',
  'scripts/ci-upload-changes.mjs',
  'scripts/test-ci-upload-changes.mjs',
  'src/lib/photoUploadContract.ts',
  'package.json',
  'pnpm-lock.yaml',
]);
const databaseFiles = new Set([
  'scripts/account-hook-probe.mjs',
  'scripts/account-hook-browser-check.html',
  'scripts/test-account-hook-probe.mjs',
  'scripts/check-account-security.mjs',
  'scripts/test-account-security.mjs',
  'scripts/test-account-security-ci.mjs',
  'src/lib/authEmail.ts',
  'src/lib/authEmail.test.ts',
  'scripts/prepare-fresh-schema.mjs',
  'scripts/check-upload-storage.mjs',
  'scripts/test-upload-server.mjs',
  'src/lib/groups.ts',
]);

export function jobsForPaths(paths) {
  if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string')) throw fail('changes', 'invalid_shape', 'Changed paths must be an array of strings.');
  const jobs = { upload_database: false, classifier_artifact: false };
  for (const path of paths) {
    if (sharedFiles.has(path)) return allJobs();
    // Documentation alone doesn't change the executable validation inputs.
    if (path.endsWith('.md')) continue;
    if (path.startsWith('vendor/libheif-')) return allJobs();
    if (path.startsWith('supabase/') || path.startsWith('src/lib/uploads/') || databaseFiles.has(path)) {
      jobs.upload_database = true;
    }
    if (path.startsWith('infrastructure/photo-classifier/') || path === 'scripts/test-heic-release-gate.mjs') jobs.classifier_artifact = true;
  }
  return jobs;
}

export function selectUploadJobs(eventName, event, git = args => execFileSync('git', args), diagnostics = createDiagnostics('ci-upload-changes')) {
  // A manual run is also the operator's way to validate all gates on demand.
  if (eventName === 'workflow_dispatch') return allJobs();
  if (!isRecord(event)) {
    diagnostics.error('event', fail('event', 'invalid_shape', 'GitHub event must be a JSON object. Both upload validation jobs will run.'));
    diagnostics.event('event', 'fallback');
    return allJobs();
  }
  const base = eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before;
  const head = eventName === 'pull_request' ? event.pull_request?.head?.sha : event.after;
  const isRevision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
  if (!['pull_request', 'push'].includes(eventName) || !isRevision(base) || !isRevision(head)) {
    diagnostics.error('event', fail('event', 'comparison_unavailable', 'Event has no supported revision comparison. Both upload validation jobs will run.'));
    diagnostics.event('event', 'fallback');
    return allJobs();
  }
  try {
    // PRs include all branch changes since the merge base; pushes compare the
    // previous and new default-branch revisions. No-renames includes both sides
    // of moved files; NUL separation handles whitespace/newlines in file names.
    const comparison = `${base}${eventName === 'pull_request' ? '...' : '..'}${head}`;
    const paths = git(['diff', '--name-only', '-z', '--no-renames', comparison, '--']).toString().split('\0').filter(Boolean);
    return jobsForPaths(paths);
  } catch {
    // Missing history (for example a force push) must never skip validation.
    diagnostics.error('git-diff', fail('git-diff', 'history_unavailable', 'Changed files could not be determined. Both upload validation jobs will run.'));
    diagnostics.event('git-diff', 'fallback');
    return allJobs();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runScript('ci-upload-changes', async diagnostics => {
  let jobs;
  try {
    const event = readJSONFile(process.env.GITHUB_EVENT_PATH, 'event', 'GitHub event', isRecord);
    jobs = selectUploadJobs(process.env.GITHUB_EVENT_NAME, event, undefined, diagnostics);
  } catch (error) {
    diagnostics.error('event', error);
    diagnostics.event('event', 'fallback');
    jobs = allJobs();
  }
  const output = Object.entries(jobs).map(([name, enabled]) => `${name}=${enabled}\n`).join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
  diagnostics.event('selection', 'completed', { count: Object.values(jobs).filter(Boolean).length });
  });
}
