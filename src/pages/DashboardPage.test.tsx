import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { demoTrips } from '../types/domain';
import { DashboardPage } from './DashboardPage';

vi.mock('../components/maps/TravelGlobe', () => ({ TravelGlobe: () => <div aria-label="Globe" /> }));
it('shows the sample trips and links to their details', () => {
  render(<MemoryRouter><DashboardPage /></MemoryRouter>);
  expect(screen.getByText(/Preview with sample trips/)).toBeInTheDocument();
  for (const trip of demoTrips) expect(screen.getByRole('link', { name: new RegExp(trip.title) })).toHaveAttribute('href', `/trips/${trip.id}`);
});
