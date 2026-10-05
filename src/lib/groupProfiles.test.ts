import { expect, it, vi } from 'vitest';
import { loadDisplayName, saveDisplayName } from './profiles';

const db = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: db }));

function response(data: { id: string } | null, error: Error | null = null) {
  db.from.mockReturnValue(db);
  db.update.mockReturnValue(db);
  db.eq.mockReturnValue(db);
  db.select.mockReturnValue(db);
  db.single.mockResolvedValue({ data, error });
}

it('saves the normalized display name to the authenticated member profile', async () => {
  response({ id: 'member' });
  await saveDisplayName('member', '  José   García  ');
  expect(db.from).toHaveBeenCalledWith('profiles');
  expect(db.update).toHaveBeenCalledWith({ display_name: 'José García' });
  expect(db.eq).toHaveBeenCalledWith('id', 'member');
});

it('rejects an explicit name without attempting a profile update', async () => {
  response({ id: 'member' });
  await expect(saveDisplayName('member', 'Fuck You')).rejects.toThrow('without explicit words or phrases');
  expect(db.update).not.toHaveBeenCalled();
});

it('does not silently accept a missing or inaccessible profile', async () => {
  response(null);
  await expect(saveDisplayName('member', 'Alex')).rejects.toThrow('Your name could not be saved');
});

it('surfaces profile update errors', async () => {
  response(null, new Error('Profile unavailable'));
  await expect(saveDisplayName('member', 'Alex')).rejects.toThrow('Profile unavailable');
});

it('reads the display name from the profile instead of auth metadata', async () => {
  response(null);
  db.single.mockResolvedValueOnce({ data: { display_name: 'Alex' }, error: null });
  expect(await loadDisplayName('member')).toBe('Alex');
  expect(db.select).toHaveBeenCalledWith('display_name');
  expect(db.eq).toHaveBeenCalledWith('id', 'member');
});
