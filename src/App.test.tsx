import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { App } from './App';

vi.mock('./components/maps/TravelGlobe', () => ({ TravelGlobe: () => <div /> }));
it('routes unknown URLs back to the preview', async () => {
  render(<MemoryRouter initialEntries={['/missing']}><App /></MemoryRouter>);
  expect(await screen.findByText(/Preview with sample trips/)).toBeInTheDocument();
});
it('renders the login route', () => {
  render(<MemoryRouter initialEntries={['/login']}><App /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Good to see you.' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
});
it('shows configuration guidance for protected routes in preview mode', () => {
  render(<MemoryRouter initialEntries={['/groups']}><App /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Connect your shared atlas' })).toBeInTheDocument();
});
