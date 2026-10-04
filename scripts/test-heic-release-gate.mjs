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
