import { expect, it } from 'vitest';
import { authEmail } from './authEmail';

it.each(['traveler@example.com', 'first.last+trip@example.co.uk', "o'connor@example.com", 'drop.table@example.com'])('accepts an ordinary email as data: %s', email => {
  expect(authEmail(` ${email} `)).toBe(email);
});

it.each(['', 'DROP TABLE profiles;', "a';DROP TABLE profiles;--@example.com", 'traveler😀@example.com', 'josé@example.com', 'traveler@exämple.com', 'traveler@😀.com', 'a\n@example.com', '.a@example.com', 'a..b@example.com', `${'a'.repeat(65)}@example.com`, `a@${'b'.repeat(64)}.com`])('rejects invalid account identifiers: %s', email => {
  expect(() => authEmail(email)).toThrow('Enter a valid email address using only ASCII characters.');
});
