import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('.', import.meta.url));
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'traveled-notes-test-'));
  const run = (cmd, args, env = {}) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  const git = (...args) => {
    const result = run('git', args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--quiet');
  mkdirSync(join(cwd, 'scripts'));
  for (const file of ['review-staged.mjs', 'local-notes.mjs']) copyFileSync(join(source, file), join(cwd, 'scripts', file));
  copyFileSync(join(source, '..', '.gitignore'), join(cwd, '.gitignore'));
  const notes = '# Handwritten overview\n\nKeep this exact text.\n\n## Review-approved changes\n\nOlder handwritten history.\n';
  writeFileSync(join(cwd, 'NOTES.md'), notes);
  writeFileSync(join(cwd, 'change.txt'), 'first\n');
  git('add', 'change.txt');
  const stub = join(cwd, 'reviewer.cjs');
  writeFileSync(stub, `#!/usr/bin/env node
const fs = require('node:fs');
const cp = require('node:child_process');
fs.writeFileSync('reviewer-started', 'yes');
process.stdin.resume();
process.stdin.on('end', () => {
  if (process.env.MODE === 'index') {
    fs.writeFileSync('change.txt', 'changed during review');
    cp.execFileSync('git', ['add', 'change.txt']);
  }
  const findings = process.env.MODE === 'fail' ? [{severity:'P1', location:'change.txt:1', title:'Stub finding', explanation:'Intentional test failure'}] : [];
  fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], JSON.stringify({findings, summary:'Stub review'}));
});
`, { mode: 0o700 });
  const draft = () => writeFileSync(join(cwd, 'NOTES.draft.json'), JSON.stringify({ title: 'Fixture change', changes: ['Changed fixture'], rationale: 'Exercise the workflow', tradeoffs: ['No relevant alternative'], validation: ['Fixture assertions'] }));
  const bind = () => run(process.execPath, ['scripts/local-notes.mjs', 'bind']);
  const review = (mode = '', env = {}) => run(process.execPath, ['scripts/review-staged.mjs'], { CODEX_BIN: stub, MODE: mode, ...env });
  const read = () => readFileSync(join(cwd, 'NOTES.md'), 'utf8');
  return { cwd, git, notes, draft, bind, review, read };
}

test('successful review preserves content, ignores local files, and retries without duplicates', () => {
  const f = fixture();
  f.draft();
  assert.equal(f.bind().status, 0);
  assert.equal(f.git('check-ignore', 'NOTES.md', 'NOTES.draft.json').split('\n').length, 2);
  const result = f.review();
  assert.equal(result.status, 0, result.stderr);
  const saved = f.read();
  assert.ok(saved.includes('# Handwritten overview\n\nKeep this exact text.'));
  assert.ok(saved.includes('Older handwritten history.'));
  assert.ok(saved.includes('Fixture change'));
  assert.equal(f.review().status, 0);
  assert.equal(f.read(), saved);
});

for (const filename of ['NOTES.draft.json', 'NOTES.md', '.local-notes-recovery.tmp']) {
  test(`force-staged ${filename} is rejected before reviewer starts`, () => {
    const f = fixture();
    f.draft();
    if (filename.endsWith('.tmp')) writeFileSync(join(f.cwd, filename), 'Private recovery content');
    f.git('add', '-f', filename);
    assert.equal(f.bind().status, 0);
    const result = f.review();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /A local notes file is staged/);
    assert.equal(existsSync(join(f.cwd, 'reviewer-started')), false);
    assert.equal(f.read(), f.notes);
  });
}

for (const mode of ['fail', 'missing', 'malformed', 'stale', 'index', 'parent', 'missing-notes', 'write-failure']) {
  test(`${mode} blocks publication`, () => {
    const f = fixture();
    if (mode !== 'missing') { f.draft(); assert.equal(f.bind().status, 0); }
    if (mode === 'malformed') writeFileSync(join(f.cwd, 'NOTES.draft.json'), '{');
    if (mode === 'stale') { writeFileSync(join(f.cwd, 'change.txt'), 'different'); f.git('add', 'change.txt'); }
    if (mode === 'parent') {
      const draftPath = join(f.cwd, 'NOTES.draft.json');
      const data = JSON.parse(readFileSync(draftPath, 'utf8'));
      data.parent = 'stale-parent';
      writeFileSync(draftPath, JSON.stringify(data));
    }
    if (mode === 'missing-notes' || mode === 'write-failure') {
      // Preserve the fixture notes while making the destination unavailable.
      const renamed = spawnSync('mv', [join(f.cwd, 'NOTES.md'), join(f.cwd, 'saved-notes.md')]);
      assert.equal(renamed.status, 0);
      if (mode === 'write-failure') mkdirSync(join(f.cwd, 'NOTES.md'));
    }
    const result = f.review(mode);
    assert.equal(result.status, 1, result.stderr);
    if (!['missing-notes', 'write-failure'].includes(mode)) assert.equal(f.read(), f.notes);
    else assert.equal(readFileSync(join(f.cwd, 'saved-notes.md'), 'utf8'), f.notes);
  });
}

test('empty staged diff skips reviewer and notes', () => {
  const f = fixture();
  f.git('rm', '--cached', 'change.txt');
  assert.equal(f.review('fail').status, 0);
  assert.equal(f.read(), f.notes);
  assert.equal(f.bind().status, 1);
});

test('atomic rename failure blocks commit and preserves original notes', () => {
  const f = fixture();
  f.draft();
  assert.equal(f.bind().status, 0);
  const preload = join(f.cwd, 'fail-rename.cjs');
  writeFileSync(preload, `
const fs = require('node:fs');
fs.renameSync = () => { throw new Error('Simulated atomic rename failure'); };
require('node:module').syncBuiltinESMExports();
`);
  const result = f.review('', { NODE_OPTIONS: `--require=${preload}` });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Simulated atomic rename failure/);
  assert.equal(f.read(), f.notes);
  assert.equal(f.review().status, 0);
});
