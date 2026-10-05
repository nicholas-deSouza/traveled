import { afterEach, expect, it, vi } from 'vitest';
import { forgetInvitation, pendingInvitation, rememberInvitation } from './pendingInvitation';

const token = 'a'.repeat(64);
afterEach(() => window.localStorage.removeItem('traveled:pending-invitation'));

it('remembers a valid invitation across authentication and clears only the accepted invitation', () => {
  rememberInvitation(`/join#token=${token}`);
  expect(pendingInvitation()).toBe(`/join#token=${token}`);
  forgetInvitation('b'.repeat(64));
  expect(pendingInvitation()).toBe(`/join#token=${token}`);
  forgetInvitation(token);
  expect(pendingInvitation()).toBeNull();
});

it.each(['https://evil.example/join#token=' + token, '/groups#token=' + token, '/join#token=invalid', '/join#access_token=' + token])('does not remember invalid destinations or auth fragments: %s', path => {
  rememberInvitation(path);
  expect(pendingInvitation()).toBeNull();
});

it('expires pending invitations after seven days', () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
  rememberInvitation(`/join#token=${token}`);
  vi.mocked(Date.now).mockReturnValue(1_000_000 + 7 * 24 * 60 * 60 * 1000);
  expect(pendingInvitation()).toBeNull();
});

it('does not block signup or joining if browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable'); });
  expect(() => rememberInvitation(`/join#token=${token}`)).not.toThrow();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
  expect(pendingInvitation()).toBeNull();
  expect(() => forgetInvitation(token)).not.toThrow();
});
