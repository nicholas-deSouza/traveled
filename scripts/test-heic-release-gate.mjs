import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('every selected Linux artifact job requires cropped HEIC compatibility', () => {
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = workflow.split('\n  classifier-artifact:')[1];
  assert.ok(job, 'Linux artifact job must exist');
  const corpusCalls = job.split('\n').filter(line => line.includes('/test/heic-corpus.mjs'));
  assert.equal(corpusCalls.length, 1, 'one strict corpus run must cover every event');
  assert.match(corpusCalls[0], /\/artifact --require-crop --fixtures \/workspace\/infrastructure\/photo-classifier\/test\/fixtures\/heic\s*$/);
  assert.match(job, /-v "\$PWD:\/workspace:ro"/, 'checked-in fixtures must be mounted read-only');
  assert.doesNotMatch(job, /if:.*workflow_dispatch/, 'crop acceptance must not be manual-only');
  assert.match(job, /--platform linux\/amd64/);
  assert.match(job, /build-nodejs24\.x/);
});

test('root and classifier-local corpus commands use checked-in fixtures', () => {
  for (const [file, directory] of [
    ['../package.json', 'infrastructure/photo-classifier/test/fixtures/heic'],
    ['../infrastructure/photo-classifier/package.json', 'test/fixtures/heic'],
  ]) {
    const { scripts } = JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
    const args = scripts['test:heic:corpus'].split(/\s+/);
    assert.ok(args.includes('--require-crop'));
    assert.equal(args[args.indexOf('--fixtures') + 1], directory, `${file}: corpus must run offline`);
    assert.ok(readFileSync(new URL(`../${file.includes('classifier') ? 'infrastructure/photo-classifier/' : ''}${directory}/clap_cropped.heic`, import.meta.url)).length);
  }
});
