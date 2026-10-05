import { expect, it, vi } from 'vitest';
import { GroupAccessError, loadGroup } from './groups';

const from = vi.hoisted(() => vi.fn());
vi.mock('./supabase', () => ({ supabase: { from } }));

type Response = { data: unknown; error: { code: string; message: string } | null; status: number };

function respond(error: { code: string; message: string } | null, status: number, failedTable = 'groups', overrides: Record<string, Response> = {}) {
  from.mockImplementation(table => {
    const result = overrides[table] ?? (table === failedTable ? { data: null, error, status } : {
      data: table === 'groups' ? { id: 'group', name: 'Friends', created_by: 'owner' } : [], error: null, status: 200,
    });
    const query = {
      select: vi.fn(() => query), eq: vi.fn(() => query),
      single: vi.fn().mockResolvedValue(result),
      order: vi.fn().mockResolvedValue(result),
    };
    expect(['groups', 'trips', 'group_members']).toContain(table);
    return query;
  });
}

it.each([['PGRST116', 406], ['42501', 403]])('identifies denied or missing group access: %s', async (code, status) => {
  respond({ code: String(code), message: 'Group unavailable' }, Number(status));
  await expect(loadGroup('group')).rejects.toBeInstanceOf(GroupAccessError);
});

it.each(['groups', 'trips', 'group_members'])('preserves session errors from %s so a refresh can be retried', async table => {
  const error = { code: 'PGRST301', message: 'JWT expired' };
  respond(error, 401, table);
  await expect(loadGroup('group')).rejects.toBe(error);
});

it('treats anonymous insufficient-privilege responses as session errors', async () => {
  const error = { code: '42501', message: 'Authentication required' };
  respond(error, 401);
  await expect(loadGroup('group')).rejects.toBe(error);
});

it.each([406, 403])('prioritizes a session error over another query reporting inaccessible data (%s)', async status => {
  const error = { code: 'PGRST301', message: 'JWT expired' };
  respond(error, 401, 'group_members', {
    groups: { data: null, error: { code: status === 406 ? 'PGRST116' : '42501', message: 'Group unavailable' }, status },
  });
  await expect(loadGroup('group')).rejects.toBe(error);
});

it('provides a retryable error for a 401 without an error body', async () => {
  respond(null, 401);
  await expect(loadGroup('group')).rejects.toThrow('Your session could not be verified. Please try again.');
});

it('preserves temporary connection errors so refresh can retain previously loaded content', async () => {
  const error = { code: 'PGRST000', message: 'Temporarily unavailable' };
  respond(error, 503);
  await expect(loadGroup('group')).rejects.toBe(error);
});
