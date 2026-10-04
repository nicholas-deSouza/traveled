import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAccountChecks } from './check-account-security.mjs';
import { createDiagnostics } from './script-diagnostics.mjs';

const env = { UPLOAD_TEST_URL: 'http://127.0.0.1:54321', UPLOAD_TEST_SERVICE_KEY: 'service-fixture', UPLOAD_TEST_ANON_KEY: 'anon-fixture' };
const quiet = createDiagnostics('test', () => {});
function api({ leak = false, hideNames = false, ignoreRemoval = false, allowInvalidSignup = false, genericRejection = false, wrongRoles = false, leakRoster = false } = {}) {
  const actors = [], group = 'group';
  let joined = false;
  return async (url, options) => {
    const path = new URL(url).pathname, token = options.headers.Authorization.slice(7);
    let value;
    if (path === '/auth/v1/signup') {
      const body = JSON.parse(options.body);
      if (!body.data && !allowInvalidSignup) return Response.json(genericRejection ? { code: 'email_address_invalid', msg: 'Invalid email' } : { msg: 'Enter a valid email address using only ASCII characters.' }, { status: 400 });
      if (!body.data) return Response.json({ access_token: 'unexpected', user: { id: 'unexpected' } });
      const id = `user-${actors.length}`, name = JSON.parse(options.body).data.display_name;
      actors.push({ id, display_name: name });
      value = { access_token: id, user: { id } };
    } else if (path === '/rest/v1/rpc/create_group') value = group;
    else if (path === '/rest/v1/rpc/create_group_invitation') value = [{ token: 'invitation' }];
    else if (path === '/rest/v1/rpc/accept_group_invitation') { joined = true; value = group; }
    else if (path === '/rest/v1/profiles') value = leak ? actors : actors.filter(actor => actor.id === token || (joined && ['user-0','user-1'].includes(token) && ['user-0','user-1'].includes(actor.id)));
    else if (path === '/rest/v1/group_members' && options.method === 'DELETE') {
      if (!ignoreRemoval) joined = false;
      return new Response(null, { status: 204 });
    } else if (path === '/rest/v1/group_members' && token === 'service-fixture') value = [{ user_id: 'user-0' }];
    else if (path === '/rest/v1/group_members') value = !leakRoster && (token === 'user-2' || (token === 'user-1' && !joined)) ? [] : actors.slice(0,2).map((actor, index) => ({ user_id: actor.id, role: wrongRoles ? 'member' : index === 0 ? 'owner' : 'member', profiles: hideNames ? null : { display_name: actor.display_name } }));
    else throw new Error('Unexpected test request');
    return Response.json(value);
  };
}
test('account API gate refuses hosted origins before any requests', async () => {
  let calls = 0;
  await assert.rejects(runAccountChecks({ ...env, UPLOAD_TEST_URL: 'https://example.supabase.co' }, () => { calls++; }, quiet), { code: 'nonlocal_origin' });
  assert.equal(calls, 0);
});
test('account API gate accepts current peers, populated embeds and removal', async () => {
  await runAccountChecks(env, api(), quiet);
});
test('account API gate detects global profile enumeration', async () => {
  await assert.rejects(runAccountChecks(env, api({ leak: true }), quiet), { code: 'self-only' });
});
test('account API gate detects roster-name regression', async () => {
  await assert.rejects(runAccountChecks(env, api({ hideNames: true }), quiet), { code: 'embedded-roster-names' });
});
test('generic Auth email rejection never proves hook activation', async () => {
  await assert.rejects(runAccountChecks(env, api({ genericRejection: true }), quiet), { stage: 'hook-activation', code: 'invalid_shape' });
});
test('activation probe uses a unique 65-character ASCII local part and stops on generic rejection', async () => {
  const validApi = api();
  let probe;
  await assert.rejects(runAccountChecks(env, (url, options) => {
    const body = options.body && JSON.parse(options.body);
    if (new URL(url).pathname === '/auth/v1/signup' && !body.data) {
      assert.equal(probe, undefined, 'activation must stop before further policy or roster requests');
      probe = body.email;
      return Response.json({ code: 'email_address_invalid' }, { status: 422 });
    }
    assert.equal(new URL(url).pathname, '/auth/v1/signup');
    return validApi(url, options);
  }, quiet), { stage: 'hook-activation', code: 'invalid_shape' });
  assert.equal(probe.split('@')[0].length, 65);
  assert.match(probe, /^[a-z0-9-]+@example\.test$/);
});
test('account API gate checks the roster roles consumed by the app', async () => {
  await assert.rejects(runAccountChecks(env, api({ wrongRoles: true }), quiet), { code: 'embedded-roster-names' });
});
test('account API gate detects roster access by outsiders', async () => {
  await assert.rejects(runAccountChecks(env, api({ leakRoster: true }), quiet), { code: 'outsider-roster' });
});
test('account API gate detects retained peer access after removal', async () => {
  await assert.rejects(runAccountChecks(env, api({ ignoreRemoval: true }), quiet), { code: 'owner-after-removal' });
});
test('account API gate fails when direct invalid signup succeeds', async () => {
  await assert.rejects(runAccountChecks(env, api({ allowInvalidSignup: true }), quiet), { code: 'http_status' });
});
test('account API gate never counts an unrelated hook outage as policy enforcement', async () => {
  const validApi = api();
  await assert.rejects(runAccountChecks(env, (url, options) => {
    if (new URL(url).pathname === '/auth/v1/signup' && !JSON.parse(options.body).data) return Response.json({ msg: 'Internal error' }, { status: 500 });
    return validApi(url, options);
  }, quiet), { code: 'http_status' });
});
test('account diagnostics do not expose signup identities, credentials or provider response text', async () => {
  const lines = [], diagnostics = createDiagnostics('test', line => lines.push(line));
  const validApi = api();
  await assert.rejects(runAccountChecks(env, (url, options) => {
    if (new URL(url).pathname === '/auth/v1/signup' && !JSON.parse(options.body).data) {
      return Response.json({ msg: 'private-provider-response@example.test service-fixture' }, { status: 422 });
    }
    return validApi(url, options);
  }, diagnostics), { code: 'invalid_shape' });
  assert.doesNotMatch(lines.join('\n'), /example\.test|service-fixture|anon-fixture|user-\d|access_token/);
});
