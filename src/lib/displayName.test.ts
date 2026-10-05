import { expect, it } from 'vitest';
import { displayName } from './displayName';

it.each(['Alex', 'José García', '李明', 'محمد', 'Anne-Marie', "O’Connor", 'Dick', 'Dickson', 'Scunthorpe', 'Cassandra', 'S. Smith'])('accepts the name %s', name => {
  expect(displayName(name)).toBe(name);
});
it('normalizes whitespace without changing the displayed spelling', () => {
  expect(displayName('  José   García  ')).toBe('José García');
});
it.each(['Fuck You', 'FUCK', 'f.u.c.k', 'f u c k', 'fück', 'Bullshit', 'asshole', 'pornography', 'sex with children'])('rejects explicit names: %s', name => {
  expect(() => displayName(name)).toThrow('without explicit words or phrases');
});
it.each(['', '  ', 'a'.repeat(81), '123', '<script>', 'Alex😀', 'f0ck'])('rejects invalid names: %s', name => {
  expect(() => displayName(name)).toThrow('Enter a name');
});
