import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Card } from './card';

it('renders content and forwards semantic attributes and custom styles', () => {
  render(<Card role="region" aria-label="Trip" className="p-5">Shared memories</Card>);
  expect(screen.getByRole('region', { name: 'Trip' })).toHaveTextContent('Shared memories');
  expect(screen.getByRole('region')).toHaveClass('p-5');
});
