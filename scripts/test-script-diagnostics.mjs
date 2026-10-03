import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiCall, createDiagnostics, fail, parseJSON, request, runCommand } from './script-diagnostics.mjs';

function capture() {
  const records = [];
  return { records, diagnostics: createDiagnostics('test', line => records.push(JSON.parse(line))) };
}

test('HTTP diagnostics identify empty, malformed, wrong-type and wrong-shape responses without logging bodies', async () => {
  for (const [response, code] of [
    [new Response(null, { status: 200 }), 'empty_response'],
    [new Response('secret-body', { headers: { 'content-type': 'application/json' } }), 'invalid_json'],
    [new Response('<html>secret-body</html>', { headers: { 'content-type': 'text/html' } }), 'unexpected_content_type'],
    [Response.json({ token: 'secret-body' }), 'invalid_shape'],
  ]) {
    const { records, diagnostics } = capture();
    await assert.rejects(request(async () => response, 'https://service.invalid/private-path?secret=query', {
      headers: { Authorization: 'Bearer secret-header' }, body: 'secret-input',
    }, { stage: 'health', label: 'Health check', diagnostics, json: true,
      validate: value => Number.isSafeInteger(value.processed), expected: 'an integer processed field' }),
    error => error.code === code && error.details.status === 200);
    assert.equal(records.at(-1).code, code);
    const text = JSON.stringify(records);
    for (const secret of ['secret-body', 'secret-header', 'secret-input', 'private-path', 'secret=query']) assert.ok(!text.includes(secret));
  }
});

test('successful bodyless writes are accepted while unexpected statuses are rejected', async () => {
  const { records, diagnostics } = capture();
  const response = new Response(null, { status: 204 });
  assert.equal(await request(async () => response, 'https://service.invalid', {}, {
    stage: 'secrets', label: 'Secret write', diagnostics, statuses: [201, 204],
  }), response);
  assert.equal(records.at(-1).status, 204);
  await assert.rejects(request(async () => Response.json({}), 'https://service.invalid', {}, {
    stage: 'auth', label: 'Authorization probe', diagnostics, statuses: [401],
  }), error => error.code === 'http_status' && error.details.status === 200);
});

test('timeouts, network failures and oversized responses have distinct safe errors', async () => {
  for (const [cause, code] of [[new DOMException('secret', 'TimeoutError'), 'request_timeout'], [new Error('secret'), 'request_failed']]) {
    await assert.rejects(request(async () => { throw cause; }, 'https://service.invalid', {}, {
      stage: 'health', label: 'Health check', json: true,
    }), error => error.code === code && !error.message.includes('secret'));
  }
  await assert.rejects(request(async () => Response.json({ body: 'secret'.repeat(20) }), 'https://service.invalid', {}, {
    stage: 'health', label: 'Health check', json: true, maxBytes: 32,
  }), error => error.code === 'response_too_large' && !error.message.includes('secret'));
});

test('metadata is allowlisted and repeated failures are logged once', () => {
  const { records, diagnostics } = capture();
  diagnostics.event('health', 'started', { status: 200, count: 2, secret: 'hidden', headers: { Authorization: 'hidden' } });
  const error = fail('health', 'invalid_shape', 'Expected a health object.', { bytes: 3, response: 'hidden' });
  diagnostics.error('script', error);
  diagnostics.error('script', error);
  diagnostics.error('script', new Error('hidden'));
  assert.equal(records.length, 3);
  assert.equal(records[1].stage, 'health');
  assert.equal(records[2].code, 'unexpected_failure');
  assert.ok(!JSON.stringify(records).includes('hidden'));
});

test('JSON files and API responses are validated before downstream property access', async () => {
  assert.throws(() => parseJSON('null', 'report', 'Review report', Array.isArray), error => error.code === 'invalid_shape');
  const { diagnostics } = capture();
  await assert.rejects(apiCall('pull-request', async () => ({ data: null }), value => Array.isArray(value.data), diagnostics), error => error.code === 'invalid_shape');
  await assert.rejects(apiCall('pull-request', async () => { throw Object.assign(new Error('secret'), { status: 403 }); }, undefined, diagnostics), error => error.details.status === 403 && !error.message.includes('secret'));
});

test('subprocess failures report the stage and exit status without command arguments or native messages', () => {
  const { records, diagnostics } = capture();
  const success = runCommand('tool', ['secret-argument'], {}, 'build', diagnostics, () => ({ status: 0, stdout: 'result' }));
  assert.equal(success.stdout, 'result');
  assert.throws(() => runCommand('tool', ['secret-argument'], {}, 'build', diagnostics, () => ({ status: 7, stderr: 'secret' })),
    error => error.code === 'process_failed' && error.details.exit_status === 7);
  assert.throws(() => runCommand('tool', [], {}, 'build', diagnostics, () => ({ status: null, error: new Error('secret') })),
    error => error.code === 'process_start_failed');
  assert.ok(!JSON.stringify(records).includes('secret'));
});
