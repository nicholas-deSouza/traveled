// This is input validation, not an authorization or SQL-injection boundary.
// Supabase Auth must independently validate requests made outside this UI.
const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

export function authEmail(value: string): string {
  const email = value.trim();
  const local = email.split('@')[0];
  if (email.length > 254 || local.length > 64 || !emailPattern.test(email) ||
    local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    throw new Error('Enter a valid email address using only ASCII characters.');
  }
  return email;
}
