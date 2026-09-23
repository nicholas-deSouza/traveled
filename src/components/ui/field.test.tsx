import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { Field } from './field';

it('labels the input and accepts keyboard input', async () => {
  render(<Field label="Email" type="email" required />);
  const input = screen.getByRole('textbox', { name: 'Email' });
  await userEvent.type(input, 'traveler@example.com');
  expect(input).toHaveValue('traveler@example.com');
  expect(input).toBeRequired();
});
it('respects disabled inputs', async () => {
  render(<Field label="Name" disabled />);
  await userEvent.type(screen.getByLabelText('Name'), 'Ignored');
  expect(screen.getByLabelText('Name')).toHaveValue('');
});
