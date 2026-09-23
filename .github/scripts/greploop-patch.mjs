import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function allowedPath(path) {
  return path === 'index.html' || /^src\/(?:[\w-]+\/)*[\w.-]+\.(?:ts|tsx|css)$/.test(path);
}

const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
const split = (value) => value.split('\0').filter(Boolean);

export function checkStaged() {
  const paths = split(git('diff', '--cached', '--name-only', '-z', '--no-renames'));
  if (paths.length === 0) throw new Error('No source changes. Human attention required; nothing will be pushed.');
  if (paths.length > 30 || paths.some((path) => !allowedPath(path))) throw new Error('Patch exceeds the source-file scope or 30-file limit.');
  const raw = split(git('diff', '--cached', '--raw', '-z', '--no-renames'));
  for (let i = 0; i < raw.length; i += 2) {
    const [oldMode, newMode, , , status] = raw[i].slice(1).split(' ');
    if (!['000000', '100644'].includes(oldMode) || newMode !== '100644' || !['A', 'M'].includes(status)) {
      throw new Error('Only regular source-file additions and edits are accepted; no deletions or symlinks.');
    }
  }
  return paths;
}

export function validateResult(result, snapshot, paths) {
  if (!result || typeof result.summary !== 'string' || !Array.isArray(result.addressedThreadIds)
    || !Array.isArray(result.remainingIssues) || result.remainingIssues.some((s) => typeof s !== 'string')) {
    throw new Error('Invalid Codex result.');
  }
  for (const id of result.addressedThreadIds) {
    const thread = snapshot.threads.find((t) => t.id === id);
    if (!thread || !paths.includes(thread.path)) throw new Error('Addressed thread must belong to a changed file in the review snapshot.');
  }
  return [...new Set(result.addressedThreadIds)];
}

export function run(mode, directory, sha, snapshotFile, resultFile, artifactDirectory) {
  const snapshot = JSON.parse(readFileSync(resolve(snapshotFile), 'utf8'));
  const resultPath = resolve(resultFile);
  const artifact = resolve(artifactDirectory);
  process.chdir(directory);
  if (!/^[a-f0-9]{40}$/.test(sha) || git('rev-parse', 'HEAD').trim() !== sha) throw new Error('Checkout does not match reviewed commit.');
  if (mode === 'export') {
    // Check names before staging; never read a forbidden new/modified file into a patch.
    const paths = [...new Set([
      ...split(git('diff', 'HEAD', '--name-only', '-z', '--no-renames')),
      ...split(git('ls-files', '--others', '--exclude-standard', '-z')),
    ])];
    if (paths.length === 0 || paths.some((path) => !allowedPath(path))) {
      const result = JSON.parse(readFileSync(resultPath, 'utf8'));
      validateResult(result, snapshot, paths);
      const reason = paths.length === 0
        ? 'Codex produced no source changes. A maintainer must address the remaining issues before a new reviewed commit can start another attempt.'
        : `The proposed patch contains files outside the permitted source scope: ${paths.filter((path) => !allowedPath(path)).join(', ')}. A maintainer must handle these changes.`;
      mkdirSync(artifact, { recursive: true });
      writeFileSync(resolve(artifact, 'result.json'), JSON.stringify({ ...result, reason }));
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'patch=false\n');
      return;
    }
    git('add', '--', ...paths);
    checkStaged();
    const patch = git('diff', '--cached', '--binary', '--no-ext-diff', '--no-renames');
    if (Buffer.byteLength(patch) > 1024 * 1024) throw new Error('Patch exceeds 1 MiB.');
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    validateResult(result, snapshot, paths);
    mkdirSync(artifact, { recursive: true });
    writeFileSync(resolve(artifact, 'fix.patch'), patch);
    writeFileSync(resolve(artifact, 'result.json'), JSON.stringify(result));
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'patch=true\n');
  } else if (mode === 'apply') {
    const patchPath = resolve(artifact, 'fix.patch');
    if (readFileSync(patchPath).length > 1024 * 1024) throw new Error('Patch exceeds 1 MiB.');
    // git apply rejects paths outside the working tree. No repo code executes here.
    git('apply', '--check', '--index', patchPath);
    git('apply', '--index', patchPath);
    validateResult(JSON.parse(readFileSync(resultPath, 'utf8')), snapshot, checkStaged());
  } else throw new Error('Unknown patch operation.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(...process.argv.slice(2));
}
