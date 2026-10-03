import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDiagnostics, fail, isRecord, readJSONFile, runCommand, runScript } from '../../scripts/script-diagnostics.mjs';

const diagnostics = createDiagnostics('greploop-patch');
const policyError = message => fail('patch.policy', 'policy_rejected', message);

export function allowedPath(path) {
  return path === 'index.html' || /^src\/(?:[\w-]+\/)*[\w.-]+\.(?:ts|tsx|css)$/.test(path);
}

const git = (...args) => runCommand('git', ['-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }, `patch.git.${args[0]}`, diagnostics).stdout;
const split = (value) => value.split('\0').filter(Boolean);

export function checkStaged() {
  const paths = split(git('diff', '--cached', '--name-only', '-z', '--no-renames'));
  if (paths.length === 0) throw policyError('No source changes. Human attention required; nothing will be pushed.');
  if (paths.length > 30 || paths.some((path) => !allowedPath(path))) throw policyError('Patch exceeds the source-file scope or 30-file limit.');
  const raw = split(git('diff', '--cached', '--raw', '-z', '--no-renames'));
  for (let i = 0; i < raw.length; i += 2) {
    const [oldMode, newMode, , , status] = raw[i].slice(1).split(' ');
    if (!['000000', '100644'].includes(oldMode) || newMode !== '100644' || !['A', 'M'].includes(status)) {
      throw policyError('Only regular source-file additions and edits are accepted; no deletions or symlinks.');
    }
  }
  return paths;
}

export function validateResult(result, snapshot, paths) {
  if (!isRecord(result) || typeof result.summary !== 'string' || !Array.isArray(result.addressedThreadIds)
    || result.addressedThreadIds.some(id => typeof id !== 'string') || !Array.isArray(snapshot?.threads)
    || !Array.isArray(result.remainingIssues) || result.remainingIssues.some((s) => typeof s !== 'string')) {
    throw fail('codex-report', 'invalid_shape', 'Invalid Codex result: expected summary, string addressedThreadIds and string remainingIssues arrays, plus snapshot threads.');
  }
  for (const id of result.addressedThreadIds) {
    const thread = snapshot.threads.find((t) => t.id === id);
    if (!thread || !paths.includes(thread.path)) throw policyError('Addressed thread must belong to a changed file in the review snapshot.');
  }
  return [...new Set(result.addressedThreadIds)];
}

export function run(mode, directory, sha, snapshotFile, resultFile, artifactDirectory) {
  if (![mode, directory, sha, snapshotFile, resultFile, artifactDirectory].every(value => typeof value === 'string' && value.length > 0)
    || !['export', 'apply'].includes(mode)) throw fail('configuration', 'invalid_arguments', 'Choose export or apply and supply checkout, SHA, snapshot, report and artifact paths.');
  diagnostics.event(mode, 'started');
  const snapshot = readJSONFile(resolve(snapshotFile), 'review-snapshot', 'Review snapshot', value => isRecord(value) && Array.isArray(value.threads)
    && value.threads.every(thread => typeof thread?.id === 'string' && typeof thread.path === 'string'));
  const resultPath = resolve(resultFile);
  const artifact = resolve(artifactDirectory);
  process.chdir(directory);
  if (!/^[a-f0-9]{40}$/.test(sha) || git('rev-parse', 'HEAD').trim() !== sha) throw policyError('Checkout does not match reviewed commit.');
  if (mode === 'export') {
    // Check names before staging; never read a forbidden new/modified file into a patch.
    const paths = [...new Set([
      ...split(git('diff', 'HEAD', '--name-only', '-z', '--no-renames')),
      ...split(git('ls-files', '--others', '--exclude-standard', '-z')),
    ])];
    if (paths.length === 0 || paths.some((path) => !allowedPath(path))) {
      const result = readJSONFile(resultPath, 'codex-report', 'Codex report', isRecord);
      validateResult(result, snapshot, paths);
      const reason = paths.length === 0
        ? 'Codex produced no source changes. A maintainer must address the remaining issues before a new reviewed commit can start another attempt.'
        : `The proposed patch contains files outside the permitted source scope: ${paths.filter((path) => !allowedPath(path)).join(', ')}. A maintainer must handle these changes.`;
      mkdirSync(artifact, { recursive: true });
      writeFileSync(resolve(artifact, 'result.json'), JSON.stringify({ ...result, reason }));
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'patch=false\n');
      diagnostics.event(mode, 'skipped', { count: paths.length });
      return;
    }
    git('add', '--', ...paths);
    checkStaged();
    const patch = git('diff', '--cached', '--binary', '--no-ext-diff', '--no-renames');
    if (Buffer.byteLength(patch) > 1024 * 1024) throw policyError('Patch exceeds 1 MiB.');
    const result = readJSONFile(resultPath, 'codex-report', 'Codex report', isRecord);
    validateResult(result, snapshot, paths);
    mkdirSync(artifact, { recursive: true });
    writeFileSync(resolve(artifact, 'fix.patch'), patch);
    writeFileSync(resolve(artifact, 'result.json'), JSON.stringify(result));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'patch=true\n');
  } else if (mode === 'apply') {
    const patchPath = resolve(artifact, 'fix.patch');
    if (readFileSync(patchPath).length > 1024 * 1024) throw policyError('Patch exceeds 1 MiB.');
    // git apply rejects paths outside the working tree. No repo code executes here.
    git('apply', '--check', '--index', patchPath);
    git('apply', '--index', patchPath);
    validateResult(readJSONFile(resultPath, 'codex-report', 'Codex report', isRecord), snapshot, checkStaged());
  }
  diagnostics.event(mode, 'completed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runScript('greploop-patch', () => run(...process.argv.slice(2)), diagnostics);
}
