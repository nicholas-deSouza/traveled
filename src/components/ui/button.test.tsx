import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Button } from './button';

it('supports clicks and prevents them when disabled', async () => {
  const click = vi.fn();
  const { rerender } = render(<Button onClick={click}>Save</Button>);
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(click).toHaveBeenCalledTimes(1);
  rerender(<Button disabled onClick={click}>Save</Button>);
  await userEvent.click(screen.getByRole('button'));
  expect(click).toHaveBeenCalledTimes(1);
});
it('renders its child as a link without nesting a button', () => {
  render(<Button asChild><a href="/groups">Groups</a></Button>);
  expect(screen.getByRole('link', { name: 'Groups' })).toHaveAttribute('href', '/groups');
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
