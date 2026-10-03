import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deployBackend as deploy } from './deploy-photo-upload.mjs';
import { createDiagnostics } from './script-diagnostics.mjs';

const quiet = createDiagnostics('test', () => {});
const deployBackend = (phase, env, fetchRequest, diagnostics = quiet) => deploy(phase, env, fetchRequest, diagnostics);

const env = {
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  SUPABASE_ACCESS_TOKEN: 'management-secret',
  PHOTO_CLASSIFIER_AWS_REGION: 'us-east-1',
  PHOTO_CLASSIFIER_STACK_NAME: 'traveled-photo-classifier',
  PHOTO_CLASSIFIER_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:classifier-abc',
  AWS_DEPLOY_ROLE_ARN: 'arn:aws:iam::123456789012:role/deploy',
  PHOTO_CLASSIFIER_FUNCTION_NAME: 'arn:aws:lambda:us-east-1:123456789012:function:classifier',
  PHOTO_UPLOAD_WORKER_TOKEN: 'dedicated-worker-token-at-least-32-characters',
  PHOTO_CLASSIFIER_AWS_ACCESS_KEY_ID: 'AKIAABCDEFGHIJKLMNOP',
  PHOTO_CLASSIFIER_AWS_SECRET_ACCESS_KEY: 'invocation-secret',
};

function backend({ health = {}, fail, worker = { processed: 0 } } = {}) {
  const calls = [];
  let paused = false, scheduled = false;
  const fetchRequest = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, options, body });
    if (fail) {
      const result = fail(url, options, body);
      if (result) return result;
    }
    const json = value => Response.json(value);
    if (url.endsWith('/database/query')) {
      // Match Management API role selection: the restricted read-only role
      // has no EXECUTE grant on the service-only health function.
      if (body.query.includes('upload_health()') && body.read_only) {
        return new Response('permission denied for function upload_health', { status: 400 });
      }
      if (body.query.includes('upload_health()')) return json([{ health: {
        queues: true, cron: true, pg_net: true, admission_enabled: !paused, scheduled, ...health,
      } }]);
      if (body.query.startsWith('update upload_private.settings')) paused = true;
      if (body.query.includes('vault.create_secret')) return json([{ configured: 1 }]);
      if (body.query.includes('upload_schedule()')) scheduled = true;
      return json([]);
    }
    if (url.endsWith('/secrets')) return json([]);
    if (options.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (!options.headers.Authorization) return new Response(null, { status: 401 });
    return json(worker);
  };
  return { calls, fetchRequest };
}

test('missing or mismatched deployment settings fail before any network mutation', async () => {
  for (const overrides of [
    { SUPABASE_PROJECT_REF: '../other-project' },
    { SUPABASE_ACCESS_TOKEN: '' },
    { PHOTO_UPLOAD_WORKER_TOKEN: 'short' },
    { PHOTO_CLASSIFIER_STACK_NAME: '--bad' },
    { PHOTO_CLASSIFIER_SECRET_ARN: env.PHOTO_CLASSIFIER_SECRET_ARN.replace('us-east-1', 'us-west-2') },
    { AWS_DEPLOY_ROLE_ARN: env.AWS_DEPLOY_ROLE_ARN.replace('123456789012', '999999999999') },
    { PHOTO_CLASSIFIER_AWS_ACCESS_KEY_ID: 'ASIAABCDEFGHIJKLMNOP' },
    { PHOTO_CLASSIFIER_FUNCTION_NAME: env.PHOTO_CLASSIFIER_FUNCTION_NAME.replace('123456789012', '999999999999') },
  ]) {
    let calls = 0;
    await assert.rejects(deployBackend('configure', { ...env, ...overrides }, () => { calls++; }));
    assert.equal(calls, 0);
  }
});

test('prepare verifies existing migration before pausing; never applies schema or enables uploads', async () => {
  const api = backend();
  await deployBackend('prepare', { ...env, PHOTO_CLASSIFIER_FUNCTION_NAME: undefined }, api.fetchRequest);
  assert.deepEqual(api.calls.map(call => call.body.query), [
    'select public.upload_health() as health',
    'update upload_private.settings set admission_enabled = false where singleton',
    'select public.upload_health() as health',
  ]);
  assert.ok(api.calls.filter(call => call.body.query.includes('upload_health()'))
    .every(call => call.body.read_only === false));
  const missing = backend({ health: { queues: false } });
  await assert.rejects(deployBackend('prepare', env, missing.fetchRequest), /migration/);
  assert.equal(missing.calls.length, 1);
});

test('configure uses structured secrets and bound Vault values with stable names on repeat runs', async () => {
  const api = backend();
  await deployBackend('configure', env, api.fetchRequest);
  await deployBackend('configure', env, api.fetchRequest);
  assert.deepEqual(api.calls.slice(0, 3).map(call => call.body), api.calls.slice(3).map(call => call.body));
  const secrets = api.calls[0].body;
  assert.equal(secrets.find(secret => secret.name === 'PHOTO_CLASSIFIER_FUNCTION_NAME').value, env.PHOTO_CLASSIFIER_FUNCTION_NAME);
  assert.equal(secrets.find(secret => secret.name === 'PHOTO_CLASSIFIER_AWS_SESSION_TOKEN').value, '');
  assert.equal(secrets.some(secret => secret.name.startsWith('SUPABASE_')), false);
  assert.deepEqual(api.calls[2].body.parameters, ['photo_upload_worker_token', env.PHOTO_UPLOAD_WORKER_TOKEN]);
  assert.ok(!api.calls[2].body.query.includes(env.PHOTO_UPLOAD_WORKER_TOKEN));
  assert.ok(!api.calls[2].body.query.includes('decrypted_secrets'));
  assert.ok(api.calls.every(call => call.options.redirect === 'error'));
});

test('configure accepts empty successful secrets responses and continues configuring Vault', async () => {
  for (const status of [201, 204]) {
    const api = backend({ fail: url => url.endsWith('/secrets') ? new Response(null, { status }) : undefined });
    await deployBackend('configure', env, api.fetchRequest);
    assert.equal(api.calls.length, 3);
    assert.deepEqual(api.calls.slice(1).map(call => call.body.parameters), [
      ['photo_upload_worker_url', `https://${env.SUPABASE_PROJECT_REF}.supabase.co/functions/v1/photo-upload-worker`],
      ['photo_upload_worker_token', env.PHOTO_UPLOAD_WORKER_TOKEN],
    ]);
  }
});

test('configure rejects empty HTTP failures and still requires JSON for Vault queries', async () => {
  const denied = backend({ fail: url => url.endsWith('/secrets') ? new Response(null, { status: 403 }) : undefined });
  await assert.rejects(deployBackend('configure', env, denied.fetchRequest), /Edge runtime configuration failed \(HTTP 403\)/);
  assert.equal(denied.calls.length, 1);

  const invalid = backend({ fail: url => url.endsWith('/database/query') ? new Response(null, { status: 200 }) : undefined });
  await assert.rejects(deployBackend('configure', env, invalid.fetchRequest), /Database configuration returned an invalid response/);
  assert.equal(invalid.calls.length, 2);
});

test('failed Vault configuration is rejected and raw secret-bearing error responses are hidden', async () => {
  const api = backend({ fail: url => url.endsWith('/secrets') ? new Response(env.PHOTO_UPLOAD_WORKER_TOKEN, { status: 403 }) : undefined });
  await assert.rejects(deployBackend('configure', env, api.fetchRequest), error => {
    assert.match(error.message, /HTTP 403/);
    assert.ok(!error.message.includes(env.PHOTO_UPLOAD_WORKER_TOKEN));
    return true;
  });
  assert.equal(api.calls.length, 1);
  const vault = backend({ fail: (url, options, body) => body?.query?.includes('vault.create_secret') ? Response.json([{ configured: 0 }]) : undefined });
  await assert.rejects(deployBackend('configure', env, vault.fetchRequest), /exactly one/);
  await assert.rejects(deployBackend('configure', env, () => { throw new Error(env.SUPABASE_ACCESS_TOKEN); }), error => !error.message.includes(env.SUPABASE_ACCESS_TOKEN));
});

test('verify requires CORS, authorization, an authenticated worker and active schedule while paused', async () => {
  const api = backend();
  await deployBackend('prepare', env, api.fetchRequest);
  await deployBackend('verify', env, api.fetchRequest);
  const endpoints = api.calls.filter(call => call.url.includes('/functions/'));
  assert.deepEqual(endpoints.map(call => call.options.method), ['OPTIONS', 'POST', 'POST', 'POST']);
  assert.equal(endpoints[3].options.headers.Authorization, `Bearer ${env.PHOTO_UPLOAD_WORKER_TOKEN}`);
  assert.equal(api.calls.at(-1).body.read_only, false);
  assert.equal(api.calls.at(-2).body.query, 'select public.upload_schedule()');
});

test('failed Edge boot or authentication prevents installing a new schedule', async () => {
  for (const fail of [
    (url, options) => options.method === 'OPTIONS' ? new Response('boot failure', { status: 503 }) : undefined,
    (url, options) => !url.includes('/database/') && options.method === 'POST' && !options.headers.Authorization ? Response.json({}) : undefined,
    (url, options) => url.endsWith('-worker') && options.headers.Authorization ? new Response('bad token', { status: 401 }) : undefined,
  ]) {
    const api = backend({ fail });
    await assert.rejects(deployBackend('verify', env, api.fetchRequest));
    assert.equal(api.calls.some(call => call.body?.query?.includes('upload_schedule()')), false);
  }
});

test('verify rejects an invalid worker payload, inactive schedule or enabled admission', async () => {
  for (const options of [
    { worker: { unexpected: true } },
    { health: { scheduled: false } },
    { health: { admission_enabled: true } },
  ]) {
    const api = backend(options);
    await deployBackend('prepare', env, api.fetchRequest).catch(() => {});
    await assert.rejects(deployBackend('verify', env, api.fetchRequest));
  }
});

test('malformed health and Vault responses stop before subsequent configuration', async () => {
  for (const response of [[], [{ health: null }], [{ health: { queues: 'true' } }]]) {
    const api = backend({ fail: () => Response.json(response) });
    await assert.rejects(deployBackend('prepare', env, api.fetchRequest), error => error.code === 'invalid_shape' && error.stage === 'database.health');
    assert.equal(api.calls.length, 1);
  }
  for (const rows of [[{ configured: true }], [{ configured: 1 }, { configured: 1 }]]) {
    const api = backend({ fail: url => url.endsWith('/database/query') ? Response.json(rows) : undefined });
    await assert.rejects(deployBackend('configure', env, api.fetchRequest), error => error.code === 'invalid_shape' && error.stage === 'vault.worker-url');
    assert.equal(api.calls.length, 2);
  }
});

test('deployment diagnostics show status and failure category without secret values or query parameters', async () => {
  const lines = [];
  const diagnostics = createDiagnostics('deploy-photo-upload', line => lines.push(line));
  const api = backend({ fail: url => url.endsWith('/database/query') ? new Response(env.PHOTO_UPLOAD_WORKER_TOKEN, { headers: { 'content-type': 'application/json' } }) : undefined });
  await assert.rejects(deployBackend('configure', env, api.fetchRequest, diagnostics), /not valid JSON/);
  const failure = JSON.parse(lines.at(-1));
  assert.equal(failure.stage, 'vault.worker-url');
  assert.equal(failure.status, 200);
  assert.equal(failure.code, 'invalid_json');
  for (const value of [env.SUPABASE_ACCESS_TOKEN, env.PHOTO_UPLOAD_WORKER_TOKEN, env.PHOTO_CLASSIFIER_AWS_ACCESS_KEY_ID, env.PHOTO_CLASSIFIER_AWS_SECRET_ACCESS_KEY]) assert.ok(!lines.join('\n').includes(value));
});
