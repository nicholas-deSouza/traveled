import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const allJobs = () => ({ upload_database: true, classifier_artifact: true });
const sharedFiles = new Set([
  '.github/workflows/ci.yml',
  'scripts/ci-upload-changes.mjs',
  'scripts/test-ci-upload-changes.mjs',
  'src/lib/photoUploadContract.ts',
  'package.json',
  'pnpm-lock.yaml',
]);
const databaseFiles = new Set([
  'scripts/prepare-fresh-schema.mjs',
  'scripts/check-upload-storage.mjs',
  'scripts/test-upload-server.mjs',
  'src/lib/groups.ts',
]);

export function jobsForPaths(paths) {
  const jobs = { upload_database: false, classifier_artifact: false };
  for (const path of paths) {
    if (sharedFiles.has(path)) return allJobs();
    // Documentation alone doesn't change the executable validation inputs.
    if (path.endsWith('.md')) continue;
    if (path.startsWith('supabase/') || path.startsWith('src/lib/uploads/') || databaseFiles.has(path)) {
      jobs.upload_database = true;
    }
    if (path.startsWith('infrastructure/photo-classifier/')) jobs.classifier_artifact = true;
  }
  return jobs;
}

export function selectUploadJobs(eventName, event, git = args => execFileSync('git', args)) {
  // A manual run is also the operator's way to validate all gates on demand.
  if (eventName === 'workflow_dispatch') return allJobs();
  const base = eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before;
  const head = eventName === 'pull_request' ? event.pull_request?.head?.sha : event.after;
  const isRevision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
  if (!['pull_request', 'push'].includes(eventName) || !isRevision(base) || !isRevision(head)) return allJobs();
  try {
    // PRs include all branch changes since the merge base; pushes compare the
    // previous and new default-branch revisions. No-renames includes both sides
    // of moved files; NUL separation handles whitespace/newlines in file names.
    const comparison = `${base}${eventName === 'pull_request' ? '...' : '..'}${head}`;
    const paths = git(['diff', '--name-only', '-z', '--no-renames', comparison, '--']).toString().split('\0').filter(Boolean);
    return jobsForPaths(paths);
  } catch {
    // Missing history (for example a force push) must never skip validation.
    return allJobs();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let jobs;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    jobs = selectUploadJobs(process.env.GITHUB_EVENT_NAME, event);
  } catch {
    jobs = allJobs();
  }
  const output = Object.entries(jobs).map(([name, enabled]) => `${name}=${enabled}\n`).join('');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}
