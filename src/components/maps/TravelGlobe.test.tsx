import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { demoTrips } from '../../types/domain';
import { TravelGlobe } from './TravelGlobe';

const map = vi.hoisted(() => ({ addControl: vi.fn(), on: vi.fn(), setProjection: vi.fn(), addSource: vi.fn(), addLayer: vi.fn(), remove: vi.fn() }));
vi.mock('maplibre-gl', () => ({ default: {
  Map: vi.fn(function () { return map; }), NavigationControl: vi.fn(),
} }));
it('initializes trip markers on style load and releases the map on unmount', () => {
  const { unmount } = render(<TravelGlobe />);
  expect(screen.getByLabelText('Interactive globe with your trips')).toBeInTheDocument();
  const onLoad = map.on.mock.calls.find(([event]) => event === 'style.load')![1];
  onLoad();
  expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' });
  expect(map.addSource).toHaveBeenCalledWith('trips', expect.objectContaining({
    data: expect.objectContaining({ features: expect.arrayContaining(demoTrips.map(trip => expect.objectContaining({ geometry: { type: 'Point', coordinates: [trip.longitude, trip.latitude] } }))) }),
  }));
  expect(map.addLayer).toHaveBeenCalledTimes(2);
  unmount();
  expect(map.remove).toHaveBeenCalledTimes(1);
});
