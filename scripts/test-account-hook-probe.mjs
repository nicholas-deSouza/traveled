import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probeAccountHook } from './account-hook-probe.mjs';

const identity = '00000000-0000-0000-0000-000000000001';
test('probe requires exact hook evidence and sends no password', async () => {
  const auth = { async signInWithOtp(body) {
    assert.equal(body.email.split('@')[0].length, 65);
    assert.equal(body.email.split('@')[1], 'example.test');
    assert.equal('password' in body, false);
    assert.deepEqual(body.options, { shouldCreateUser: true });
    return { error: { message: 'Enter a valid email address using only ASCII characters.' } };
  } };
  assert.match(await probeAccountHook(auth, identity), /^PASS:/);
});
test('generic validation, acceptance and unrelated errors cannot count as hook invocation', async () => {
  for (const error of [null, { message: 'Invalid email', code: 'email_address_invalid' }, { message: 'rate limited' }]) {
    await assert.rejects(probeAccountHook({ signInWithOtp: async () => ({ error }) }, identity), /invocation unproven/);
  }
});
test('invalid probe identity fails before sending', async () => {
  await assert.rejects(probeAccountHook({ signInWithOtp() { assert.fail('must not send'); } }, 'short'), /Invalid probe/);
});
