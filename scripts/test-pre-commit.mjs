import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

async function runHook({ installStatus = 0, testStatus = 0, installed = false, stale = false, broken = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'traveled-pre-commit-'));
  try {
    const bin = join(root, 'bin');
    const classifier = join(root, 'infrastructure/photo-classifier');
    await mkdir(bin);
    await mkdir(join(root, 'scripts'));
    await mkdir(classifier, { recursive: true });
    await writeFile(join(root, 'scripts/check-classifier-dependencies.mjs'),
      await readFile(new URL('./check-classifier-dependencies.mjs', import.meta.url)));
    await writeFile(join(classifier, 'package.json'), '{}');
    await writeFile(join(classifier, 'package-lock.json'), JSON.stringify({ packages: {
      '': {}, 'node_modules/sharp': { version: '0.35.5' },
      // Platform-specific optional packages need not be installed on this machine.
      'node_modules/other-platform-native': { version: '1.0.0', optional: true },
    } }));
    if (installed) {
      const sharp = join(classifier, 'node_modules/sharp');
      await mkdir(sharp, { recursive: true });
      await writeFile(join(sharp, 'package.json'), JSON.stringify({ version: stale ? '0.35.4' : '0.35.5', main: 'index.cjs' }));
      await writeFile(join(sharp, 'index.cjs'), broken ? 'throw new Error("Native module unavailable");' : 'module.exports = {};');
    }
    const calls = join(root, 'calls');
    const stubs = {
      git: 'printf "%s\\n" "$HOOK_TEST_ROOT"',
      npm: 'printf "npm %s\\n" "$*" >> "$HOOK_TEST_CALLS"; exit "$HOOK_TEST_INSTALL_STATUS"',
      pnpm: 'printf "pnpm %s\\n" "$*" >> "$HOOK_TEST_CALLS"; exit "$HOOK_TEST_STATUS"',
    };
    for (const [name, body] of Object.entries(stubs)) {
      await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    }
    const result = spawnSync('/bin/sh', [fileURLToPath(new URL('../.githooks/pre-commit', import.meta.url))], {
      cwd: root, encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOOK_TEST_ROOT: root, HOOK_TEST_CALLS: calls,
        HOOK_TEST_INSTALL_STATUS: String(installStatus), HOOK_TEST_STATUS: String(testStatus),
      },
    });
    assert.ifError(result.error);
    return { ...result, calls: (await readFile(calls, 'utf8')).trim().split('\n') };
  } finally {
    await rm(root, { recursive: true, force: true });
    await assert.rejects(access(root), { code: 'ENOENT' });
  }
}

for (const [name, state] of [
  ['missing', {}], ['outdated', { installed: true, stale: true }],
  ['broken native', { installed: true, broken: true }],
]) {
  test(`pre-commit repairs ${name} classifier dependencies before running the full suite`, async () => {
    const result = await runHook(state);
    assert.equal(result.status, 0);
    assert.deepEqual(result.calls, ['npm ci --prefix infrastructure/photo-classifier --include=optional', 'pnpm test']);
    assert.match(result.stderr, /All local tests passed/);
  });
}

test('pre-commit reuses working dependencies offline without invoking npm', async () => {
  const result = await runHook({ installed: true, installStatus: 7 });
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls, ['pnpm test']);
});

test('pre-commit blocks on installation failure without running tests', async () => {
  const result = await runHook({ installStatus: 7 });
  assert.equal(result.status, 7);
  assert.equal(result.calls.length, 1);
  assert.match(result.stderr, /Classifier dependency installation failed/);
  assert.doesNotMatch(result.stderr, /All local tests passed/);
});

for (const installed of [false, true]) {
  test(`pre-commit still blocks on test failure with ${installed ? 'reused' : 'repaired'} dependencies`, async () => {
    const result = await runHook({ installed, testStatus: 9 });
    assert.equal(result.status, 9);
    assert.equal(result.calls.length, installed ? 1 : 2);
    assert.match(result.stderr, /Tests failed/);
    assert.doesNotMatch(result.stderr, /All local tests passed/);
  });
}
