import { randomUUID } from 'node:crypto';
import { storageConfiguration } from './check-upload-storage.mjs';
import { createDiagnostics, fail, isMain, isRecord, request, runScript } from './script-diagnostics.mjs';

// Only disposable localhost Supabase; never loads .env or emits identities/tokens.
export async function runAccountChecks(env = process.env, fetchRequest = fetch, diagnostics = createDiagnostics('check-account-security')) {
  const { origin, serviceKey, anonKey } = storageConfiguration(env);
  let stage = 'signup';
  const check = (ok, code) => {
    if (!ok) throw fail(stage, code, 'Disposable account security assertion failed. Inspect the named gate.');
  };
  async function json(path, token, body, method = 'POST', validate = () => true) {
    return request(fetchRequest, origin + path, {
      method, headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, { stage, label: 'Disposable Auth/Data API', json: method !== 'DELETE', validate, diagnostics });
  }
  async function signup(name) {
    return json('/auth/v1/signup', anonKey, {
      email: `account-${randomUUID()}@example.test`, password: randomUUID() + 'aA1!', data: { display_name: name },
    }, 'POST', value => isRecord(value) && typeof value.access_token === 'string' && typeof value.user?.id === 'string');
  }
  const owner = await signup('Owner'), member = await signup('Member'), outsider = await signup('Outsider');
  stage = 'hook-activation';
  // A generic email_address_invalid response can originate in Auth before the
  // hook runs. Auth's format validator accepts an ASCII local part longer than
  // 64 characters; our hook enforces that limit. Require its distinctive message
  // and fail closed if this Auth version rejects it before invocation.
  await request(fetchRequest, origin + '/auth/v1/signup', {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${'a'.repeat(29)}${randomUUID()}@example.test`, password: randomUUID() + 'aA1!' }),
  }, {
    stage, label: 'Disposable signup hook activation', json: true, statuses: [400, 422], diagnostics,
    validate: value => isRecord(value) && !value.access_token && !value.user &&
      [value.msg, value.message, value.error_description].includes('Enter a valid email address using only ASCII characters.'),
    expected: 'the exact custom SQL hook rejection; generic Auth validation does not prove invocation',
  });
  stage = 'signup-policy';
  for (const email of [`emoji😀-${randomUUID()}@example.test`, `.leading-${randomUUID()}@example.test`, `${'a'.repeat(65)}@example.test`]) {
    await request(fetchRequest, origin + '/auth/v1/signup', {
      method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: randomUUID() + 'aA1!' }),
    }, {
      stage, label: 'Invalid disposable signup', json: true, statuses: [400, 422], diagnostics,
      validate: value => isRecord(value) && !value.access_token &&
        (value.code === 'email_address_invalid' || [value.msg, value.message, value.error_description].includes('Enter a valid email address using only ASCII characters.')),
      expected: 'an email-validation rejection; unrelated service failures do not prove enforcement',
    });
  }
  const profiles = account => json('/rest/v1/profiles?select=id,display_name', account.access_token, undefined, 'GET', Array.isArray);
  const ids = rows => rows.map(row => row.id).sort();
  const same = (actual, expected) => JSON.stringify(ids(actual)) === JSON.stringify([...expected].sort());
  stage = 'profile-isolation';
  check(same(await profiles(owner), [owner.user.id]), 'self-only');
  const group = await json('/rest/v1/rpc/create_group', owner.access_token, { group_name: 'Disposable account integration' }, 'POST', value => typeof value === 'string');
  const invitation = await json('/rest/v1/rpc/create_group_invitation', owner.access_token, { target_group_id: group }, 'POST', value => Array.isArray(value) && typeof value[0]?.token === 'string');
  check(same(await profiles(member), [member.user.id]), 'invitation-not-membership');
  await json('/rest/v1/rpc/accept_group_invitation', member.access_token, { invitation_token: invitation[0].token });
  stage = 'peer-visibility';
  check(same(await profiles(owner), [owner.user.id, member.user.id]), 'owner-peer-list');
  check(same(await profiles(member), [owner.user.id, member.user.id]), 'member-peer-list');
  check(same(await profiles(outsider), [outsider.user.id]), 'outsider-list');
  // Exactly the embed consumed by loadGroup, including PostgREST relationship resolution.
  const roster = await json(`/rest/v1/group_members?select=user_id,role,profiles(display_name)&group_id=eq.${group}&order=created_at`, member.access_token, undefined, 'GET', Array.isArray);
  check(roster.length === 2 && roster.some(row => row.user_id === owner.user.id && row.role === 'owner' && row.profiles?.display_name === 'Owner')
    && roster.some(row => row.user_id === member.user.id && row.role === 'member' && row.profiles?.display_name === 'Member'), 'embedded-roster-names');
  check((await json(`/rest/v1/group_members?select=user_id,role,profiles(display_name)&group_id=eq.${group}&order=created_at`, outsider.access_token, undefined, 'GET', Array.isArray)).length === 0, 'outsider-roster');
  stage = 'membership-removal';
  await json(`/rest/v1/group_members?group_id=eq.${group}&user_id=eq.${member.user.id}`, owner.access_token, undefined, 'DELETE');
  check(same(await profiles(owner), [owner.user.id]), 'owner-after-removal');
  check(same(await profiles(member), [member.user.id]), 'member-after-removal');
  check((await json(`/rest/v1/group_members?select=user_id,role,profiles(display_name)&group_id=eq.${group}&order=created_at`, member.access_token, undefined, 'GET', Array.isArray)).length === 0, 'removed-member-roster');
  // Service access is used only to check fixture state, never to prove user isolation.
  const remaining = await json(`/rest/v1/group_members?group_id=eq.${group}&select=user_id`, serviceKey, undefined, 'GET', Array.isArray);
  check(remaining.length === 1 && remaining[0].user_id === owner.user.id, 'removal-committed');
  diagnostics.event('account-gates', 'completed');
}

if (isMain(import.meta.url)) await runScript('check-account-security', diagnostics => runAccountChecks(process.env, fetch, diagnostics));
