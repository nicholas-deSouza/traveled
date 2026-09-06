import { spawnSync } from 'node:child_process';
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const historyHeading = '## Review-approved changes';

function git(...args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
  return result.stdout.trim();
}

export function currentParent() {
  // An unborn branch has no HEAD; other Git errors must still block publication.
  const head = git('rev-parse', '--git-path', 'HEAD');
  const ref = readFileSync(head, 'utf8').trim();
  if (ref.startsWith('ref: ')) {
    const result = spawnSync('git', ['show-ref', '--verify', '--quiet', ref.slice(5)]);
    if (result.status === 1) return 'unborn';
    if (result.error || result.status !== 0) throw new Error('Cannot resolve parent commit.');
  }
  return git('rev-parse', '--verify', 'HEAD');
}

function localFile(path) {
  try {
    if (!lstatSync(path).isFile()) throw new Error(`${path} must be a regular file.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function atomicSave(path, content, check = () => {}) {
  localFile(path);
  const temporary = join(dirname(path), `.local-notes-${randomUUID()}.tmp`);
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, content, 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  check();
  renameSync(temporary, path);
}

function readDraft(root) {
  const path = join(root, 'NOTES.draft.json');
  localFile(path);
  const draft = JSON.parse(readFileSync(path, 'utf8'));
  const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
  if (!draft || !nonempty(draft.title) || /[\r\n]/.test(draft.title) || !nonempty(draft.rationale)
      || !['changes', 'tradeoffs', 'validation'].every((key) => Array.isArray(draft[key]) && draft[key].length > 0 && draft[key].every(nonempty))) {
    throw new Error('Malformed NOTES.draft.json: title, rationale, changes, tradeoffs, and validation are required.');
  }
  return draft;
}

function verifySnapshot(tree, parent) {
  if (git('write-tree') !== tree || currentParent() !== parent) {
    throw new Error('Staged tree or parent changed. Refresh the notes draft, bind it, and retry.');
  }
}

export function bindDraft() {
  const root = git('rev-parse', '--show-toplevel');
  if (!git('diff', '--cached', '--name-only')) throw new Error('No staged changes to bind.');
  const draft = readDraft(root);
  const tree = git('write-tree');
  const parent = currentParent();
  atomicSave(join(root, 'NOTES.draft.json'), `${JSON.stringify({ ...draft, tree, parent }, null, 2)}\n`, () => verifySnapshot(tree, parent));
  console.error(`Notes draft bound to ${tree}.`);
}

export function publishNotes(tree, parent) {
  verifySnapshot(tree, parent);
  const root = git('rev-parse', '--show-toplevel');
  const draft = readDraft(root);
  if (draft.tree !== tree || draft.parent !== parent) throw new Error('Notes draft is stale. Update it and run node scripts/local-notes.mjs bind.');
  const path = join(root, 'NOTES.md');
  localFile(path);
  // Missing notes are an error: never silently replace the project's overview.
  const previous = readFileSync(path, 'utf8');
  const marker = `<!-- local-notes:${parent}:${tree} -->`;
  if (previous.split('\n').includes(marker)) return;
  const bullets = (values) => values.map((value) => `- ${value.trim().replace(/\n/g, '\n  ')}`).join('\n');
  const entry = `${marker}\n### ${new Date().toISOString().slice(0, 10)} — ${draft.title.trim()}\n\n**High-level changes**\n${bullets(draft.changes)}\n\n**Decision rationale**\n${draft.rationale.trim()}\n\n**Tradeoffs and alternatives**\n${bullets(draft.tradeoffs)}\n\n**Validation**\n${bullets(draft.validation)}\n\nStaged snapshot: \`${tree}\` · Parent: \`${parent}\`\n\n`;
  const heading = /^## Review-approved changes\r?$/m.exec(previous);
  let next;
  if (heading) {
    const position = heading.index + heading[0].length;
    next = `${previous.slice(0, position)}\n\n${entry}${previous.slice(position)}`;
  } else {
    next = `${previous}\n\n${historyHeading}\n\n${entry}`;
  }
  atomicSave(path, next, () => {
    verifySnapshot(tree, parent);
    if (readFileSync(path, 'utf8') !== previous) throw new Error('Notes changed during publication. Retry.');
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== 'bind') throw new Error('Usage: node scripts/local-notes.mjs bind');
    bindDraft();
  } catch (error) {
    console.error(`Notes blocked: ${error.message}`);
    process.exitCode = 1;
  }
}
