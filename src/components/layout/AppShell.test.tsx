import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it } from 'vitest';
import { AppShell } from './AppShell';

it('provides navigation, sign-in, and the nested page', () => {
  render(<MemoryRouter initialEntries={['/groups']}><Routes><Route element={<AppShell />}><Route path="/groups" element={<p>Your trips</p>} /></Route></Routes></MemoryRouter>);
  expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Groups' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  expect(screen.getByRole('main')).toHaveTextContent('Your trips');
});
