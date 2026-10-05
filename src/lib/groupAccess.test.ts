import { expect, it, vi } from 'vitest';
import { GroupAccessError, loadGroup } from './groups';

const from = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabase: { from } }));

function respond(error: { code: string; message: string }, status: number) {
  from.mockImplementation(table => {
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query),
      single: vi.fn().mockResolvedValue({ data: null, error, status }),
      order: vi.fn().mockResolvedValue({ data: [], error: null, status: 200 }),
    };
    expect(['groups', 'trips', 'group_members']).toContain(table);
    return query;
  });
}

it.each([['PGRST116', 406], ['42501', 403], ['PGRST301', 401]])('identifies denied or missing group access: %s', async (code, status) => {
  respond({ code: String(code), message: 'Group unavailable' }, Number(status));
  await expect(loadGroup('group')).rejects.toBeInstanceOf(GroupAccessError);
});

it('preserves temporary connection errors so refresh can retain previously loaded content', async () => {
  const error = { code: 'PGRST000', message: 'Temporarily unavailable' };
  respond(error, 503);
  await expect(loadGroup('group')).rejects.toBe(error);
});
