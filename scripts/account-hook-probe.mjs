// Operator-triggered probe: never sends a password or displays identities/tokens.
// A generic Auth email rejection is not evidence that our custom hook ran.
export async function probeAccountHook(auth, identifier = crypto.randomUUID()) {
  const email = `${'a'.repeat(29)}${identifier}@example.test`;
  if (email.split('@')[0].length !== 65) throw new Error('Invalid probe identity');
  const { error } = await auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error?.message !== 'Enter a valid email address using only ASCII characters.') {
    throw new Error('Hook invocation unproven: the exact custom rejection was not returned.');
  }
  return 'PASS: hosted Auth invoked the custom signup hook and rejected the probe.';
}
