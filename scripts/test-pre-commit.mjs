import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

async function runHook({ installStatus = 0, testStatus = 0 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'traveled-pre-commit-'));
  const bin = join(root, 'bin');
  await mkdir(bin);
  const calls = join(root, 'calls');
  const stubs = {
    git: 'printf "%s\\n" "$HOOK_TEST_ROOT"',
    npm: 'printf "npm %s\\n" "$*" >> "$HOOK_TEST_CALLS"; exit "$HOOK_TEST_INSTALL_STATUS"',
    pnpm: 'printf "pnpm %s\\n" "$*" >> "$HOOK_TEST_CALLS"; exit "$HOOK_TEST_STATUS"',
  };
  for (const [name, body] of Object.entries(stubs)) {
    await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  const result = spawnSync('/bin/sh', [new URL('../.githooks/pre-commit', import.meta.url).pathname], {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOOK_TEST_ROOT: root,
      HOOK_TEST_CALLS: calls,
      HOOK_TEST_INSTALL_STATUS: String(installStatus),
      HOOK_TEST_STATUS: String(testStatus),
    },
  });
  assert.ifError(result.error);
  return { ...result, calls: (await readFile(calls, 'utf8')).trim().split('\n') };
}

test('pre-commit installs classifier native dependencies before running the full suite', async () => {
  const result = await runHook();
  assert.equal(result.status, 0);
  assert.deepEqual(result.calls, [
    'npm ci --prefix infrastructure/photo-classifier --include=optional',
    'pnpm test',
  ]);
  assert.match(result.stderr, /All local tests passed/);
});

test('pre-commit blocks on installation failure without running tests', async () => {
  const result = await runHook({ installStatus: 7 });
  assert.equal(result.status, 7);
  assert.equal(result.calls.length, 1);
  assert.match(result.stderr, /Classifier dependency installation failed/);
  assert.doesNotMatch(result.stderr, /All local tests passed/);
});

test('pre-commit still blocks on test failure after installing dependencies', async () => {
  const result = await runHook({ testStatus: 9 });
  assert.equal(result.status, 9);
  assert.equal(result.calls.length, 2);
  assert.match(result.stderr, /Tests failed/);
  assert.doesNotMatch(result.stderr, /All local tests passed/);
});
