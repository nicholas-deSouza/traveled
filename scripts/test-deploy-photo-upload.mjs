import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { deployBackend as deploy } from './deploy-photo-upload.mjs';
import { createDiagnostics } from './script-diagnostics.mjs';

const quiet = createDiagnostics('test', () => {});
const deployBackend = (phase, env, fetchRequest, diagnostics = quiet) => deploy(phase, env, fetchRequest, diagnostics);

test('automatic backend deployment includes vendored classifier build inputs', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy-photo-upload.yml', import.meta.url), 'utf8');
  const push = workflow.split('  push:')[1].split('  workflow_dispatch:')[0];
  assert.match(push, /branches: \[main\]/);
  assert.ok(push.includes("'infrastructure/photo-classifier/stage-vendor.mjs'"));
  assert.ok(push.includes("'vendor/libheif-1.23.5/**'"));
  assert.ok(workflow.indexOf('Build and smoke-test Linux Lambda contents') < workflow.indexOf('node scripts/deploy-photo-upload.mjs prepare'));
  assert.match(workflow, /id: admission\n/);
  assert.ok(workflow.includes('PHOTO_UPLOAD_ADMISSION_ENABLED_BEFORE: ${{ steps.admission.outputs.admission_enabled_before }}'));
  assert.ok(workflow.includes('PHOTO_UPLOAD_ADMISSION_REVISION: ${{ steps.admission.outputs.admission_revision }}'));
  assert.ok(!workflow.includes('if: always()'));
});

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

const verifyEnv = (state = { admission_enabled_before: true, admission_revision: '1' }) => ({
  ...env,
  PHOTO_UPLOAD_ADMISSION_ENABLED_BEFORE: String(state.admission_enabled_before),
  PHOTO_UPLOAD_ADMISSION_REVISION: state.admission_revision,
});

function backend({ health = {}, fail, worker = { processed: 0 }, queryStatus = 200, admission = true, resumeReady = true } = {}) {
  const calls = [];
  let enabled = admission, scheduled = false, revision = 0n;
  const setAdmission = value => { enabled = value; revision++; };
  const fetchRequest = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ url, options, body });
    if (fail) {
      const result = fail(url, options, body);
      if (result) return result;
    }
    const json = value => Response.json(value, { status: url.endsWith('/database/query') ? queryStatus : 200 });
    if (url.endsWith('/database/query')) {
      // Match Management API role selection: the restricted read-only role
      // has no EXECUTE grant on the service-only health function.
      if (body.query.includes('upload_health()') && body.read_only) {
        return new Response('permission denied for function upload_health', { status: 400 });
      }
      if (body.query.includes('upload_health()')) return json([{ health: {
        queues: true, cron: true, pg_net: true, admission_enabled: enabled, scheduled, ...health,
      } }]);
      if (body.query.includes('pg_catalog.pg_trigger')) return json([{ ready: resumeReady }]);
      if (body.query.startsWith('with previous as materialized')) {
        const before = enabled;
        setAdmission(false);
        return json([{ admission_enabled_before: before, admission_revision: String(revision) }]);
      }
      if (body.query.startsWith('update upload_private.settings set admission_enabled = true')) {
        if (enabled || String(revision) !== body.parameters[0]) return json([]);
        setAdmission(true);
        return json([{ admission_revision: String(revision) }]);
      }
      if (body.query.includes('vault.create_secret')) return json([{ configured: 1 }]);
      if (body.query.includes('upload_schedule()')) scheduled = true;
      return json([]);
    }
    if (url.endsWith('/secrets')) return json([]);
    if (options.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (!options.headers.Authorization) return new Response(null, { status: 401 });
    return json(worker);
  };
  return { calls, fetchRequest, setAdmission, get admissionEnabled() { return enabled; } };
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

test('prepare checks migrations and atomically remembers the previous switch while pausing', async () => {
  const api = backend();
  const state = await deployBackend('prepare', { ...env, PHOTO_CLASSIFIER_FUNCTION_NAME: undefined }, api.fetchRequest);
  assert.deepEqual(state, { admission_enabled_before: true, admission_revision: '1' });
  assert.equal(api.admissionEnabled, false);
  assert.equal(api.calls[0].body.query, 'select public.upload_health() as health');
  assert.match(api.calls[1].body.query, /pg_catalog.pg_trigger/);
  assert.match(api.calls[2].body.query, /for update/);
  assert.match(api.calls[2].body.query, /previous.admission_enabled as admission_enabled_before/);
  assert.equal(api.calls[3].body.query, 'select public.upload_health() as health');
  assert.ok(api.calls.filter(call => call.body.query.includes('upload_health()'))
    .every(call => call.body.read_only === false));
  const missing = backend({ health: { queues: false } });
  await assert.rejects(deployBackend('prepare', env, missing.fetchRequest), /migration/);
  assert.equal(missing.calls.length, 1);
  const outdated = backend({ resumeReady: false });
  await assert.rejects(deployBackend('prepare', env, outdated.fetchRequest), error => error.code === 'missing_resume_migration');
  assert.equal(outdated.admissionEnabled, true);
  assert.equal(outdated.calls.length, 2);
});

test('database queries accept HTTP 201 throughout deployment and still validate health', async () => {
  const api = backend({ queryStatus: 201 });
  const state = await deployBackend('prepare', env, api.fetchRequest);
  await deployBackend('configure', env, api.fetchRequest);
  assert.deepEqual(await deployBackend('verify', verifyEnv(state), api.fetchRequest), { admission_status: 'resumed' });
  assert.equal(api.admissionEnabled, true);
  assert.equal(api.calls.at(-3).body.query, 'select public.upload_schedule()');

  const invalid = backend({ queryStatus: 201, health: { queues: 'true' } });
  await assert.rejects(deployBackend('prepare', env, invalid.fetchRequest),
    error => error.code === 'invalid_shape' && error.stage === 'database.health');
  assert.equal(invalid.calls.length, 1);
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

test('verify resumes previously enabled uploads only after all backend checks pass', async () => {
  const api = backend();
  const state = await deployBackend('prepare', env, api.fetchRequest);
  const result = await deployBackend('verify', verifyEnv(state), api.fetchRequest);
  assert.deepEqual(result, { admission_status: 'resumed' });
  assert.equal(api.admissionEnabled, true);
  const endpoints = api.calls.filter(call => call.url.includes('/functions/'));
  assert.deepEqual(endpoints.map(call => call.options.method), ['OPTIONS', 'POST', 'POST', 'POST']);
  assert.equal(endpoints[3].options.headers.Authorization, `Bearer ${env.PHOTO_UPLOAD_WORKER_TOKEN}`);
  assert.equal(api.calls.at(-1).body.read_only, false);
  assert.equal(api.calls.at(-3).body.query, 'select public.upload_schedule()');
  assert.equal(api.calls.at(-2).body.query, 'select public.upload_health() as health');
  assert.deepEqual(api.calls.at(-1).body.parameters, [state.admission_revision]);
});

test('successful deployment leaves uploads paused when they were already disabled', async () => {
  const api = backend({ admission: false });
  const state = await deployBackend('prepare', env, api.fetchRequest);
  assert.deepEqual(await deployBackend('verify', verifyEnv(state), api.fetchRequest), { admission_status: 'kept_paused' });
  assert.equal(api.admissionEnabled, false);
  assert.ok(!api.calls.some(call => call.body?.query?.startsWith('update upload_private.settings set admission_enabled = true')));
});

test('a same-value operator pause during deployment prevents automatic resume', async () => {
  const api = backend();
  const state = await deployBackend('prepare', env, api.fetchRequest);
  api.setAdmission(false);
  assert.deepEqual(await deployBackend('verify', verifyEnv(state), api.fetchRequest), { admission_status: 'operator_override' });
  assert.equal(api.admissionEnabled, false);
});

test('an earlier deployment cannot resume a later deployment\'s pause', async () => {
  const api = backend();
  const earlier = await deployBackend('prepare', env, api.fetchRequest);
  await deployBackend('prepare', env, api.fetchRequest);
  assert.deepEqual(await deployBackend('verify', verifyEnv(earlier), api.fetchRequest), { admission_status: 'operator_override' });
  assert.equal(api.admissionEnabled, false);
});

test('verify rejects missing or invalid prepare outputs before any network request', async () => {
  for (const changes of [
    { PHOTO_UPLOAD_ADMISSION_ENABLED_BEFORE: undefined },
    { PHOTO_UPLOAD_ADMISSION_ENABLED_BEFORE: 'yes' },
    { PHOTO_UPLOAD_ADMISSION_REVISION: undefined },
    { PHOTO_UPLOAD_ADMISSION_REVISION: '1\nname=value' },
    { PHOTO_UPLOAD_ADMISSION_REVISION: '0' },
    { PHOTO_UPLOAD_ADMISSION_REVISION: '9223372036854775808' },
  ]) {
    const api = backend();
    await assert.rejects(deployBackend('verify', { ...verifyEnv(), ...changes }, api.fetchRequest), error => error.code === 'invalid_configuration');
    assert.equal(api.calls.length, 0);
  }
});

test('failed schedule or database health checks never resume admission', async () => {
  for (const stage of ['schedule', 'health']) {
    const api = backend({ fail: (url, options, body) => {
      const query = body?.query;
      if (query?.includes('upload_schedule()') && stage === 'schedule') return new Response(null, { status: 500 });
      if (query?.includes('upload_health()') && stage === 'health' && api.calls.some(call => call.body?.query?.includes('upload_schedule()')))
        return Response.json([{ health: { queues: false, cron: true, pg_net: true, scheduled: true, admission_enabled: false } }]);
    } });
    const state = await deployBackend('prepare', env, api.fetchRequest);
    await assert.rejects(deployBackend('verify', verifyEnv(state), api.fetchRequest));
    assert.equal(api.admissionEnabled, false);
    assert.ok(!api.calls.some(call => call.body?.query?.startsWith('update upload_private.settings set admission_enabled = true')));
  }
});

test('resume failures are reported instead of claiming admission was restored', async () => {
  for (const response of [new Response(null, { status: 500 }), Response.json([{ admission_revision: 'unexpected' }])]) {
    const api = backend({ fail: (url, options, body) => body?.query?.startsWith('update upload_private.settings set admission_enabled = true') ? response : undefined });
    const state = await deployBackend('prepare', env, api.fetchRequest);
    await assert.rejects(deployBackend('verify', verifyEnv(state), api.fetchRequest), error => error.stage === 'database.resume');
    assert.equal(api.admissionEnabled, false);
  }
});

test('disposable database CI runs admission revision and operator-pause assertions', async () => {
  const ci = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.ok(ci.includes('-f supabase/tests/photo_upload_admission.sql'));
});

test('failed Edge boot or authentication prevents installing a new schedule', async () => {
  for (const fail of [
    (url, options) => options.method === 'OPTIONS' ? new Response('boot failure', { status: 503 }) : undefined,
    (url, options) => !url.includes('/database/') && options.method === 'POST' && !options.headers.Authorization ? Response.json({}) : undefined,
    (url, options) => url.endsWith('-worker') && options.headers.Authorization ? new Response('bad token', { status: 401 }) : undefined,
  ]) {
    const api = backend({ fail });
    const state = await deployBackend('prepare', env, api.fetchRequest);
    await assert.rejects(deployBackend('verify', verifyEnv(state), api.fetchRequest));
    assert.equal(api.admissionEnabled, false);
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
    await assert.rejects(deployBackend('verify', verifyEnv(), api.fetchRequest));
    assert.ok(!api.calls.some(call => call.body?.query?.startsWith('update upload_private.settings set admission_enabled = true')));
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
