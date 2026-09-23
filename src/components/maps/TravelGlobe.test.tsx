import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parisPhoto, parisTrip } from '../../test/fixtures';
import { TravelGlobe } from './TravelGlobe';

const map = vi.hoisted(() => ({
  addControl: vi.fn(), on: vi.fn(), off: vi.fn(), setProjection: vi.fn(),
  addSource: vi.fn(), addLayer: vi.fn(), remove: vi.fn(),
  project: vi.fn(() => ({ x: 120, y: 160 })),
}));
vi.mock('maplibre-gl', () => ({ default: {
  Map: vi.fn(function () { return map; }), NavigationControl: vi.fn(),
} }));
const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
const atlas = { trips: [parisTrip], photos: [parisPhoto] };
beforeEach(() => {
  media.matches = false;
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  // Keep animation frames deterministic; these tests exercise map setup and UI.
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

it('plots located photos per trip and releases map resources on unmount', () => {
  const { unmount } = render(<TravelGlobe {...atlas} />);
  expect(screen.getByLabelText('Interactive globe with trip photo locations')).toBeInTheDocument();
  const onLoad = map.on.mock.calls.find(([event]) => event === 'style.load')![1];
  act(() => onLoad());
  expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' });
  expect(map.addSource).toHaveBeenCalledWith('trip-paris', expect.objectContaining({
    cluster: true,
    data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { count: 1, representative: 0 }, geometry: { type: 'Point', coordinates: [2.3522, 48.8566] } }] },
  }));
  expect(map.addLayer).toHaveBeenCalledWith(expect.objectContaining({
    id: 'trip-paris', source: 'trip-paris', paint: expect.objectContaining({ 'circle-color': '#123456' }),
  }));
  unmount();
  expect(map.remove).toHaveBeenCalledOnce();
  expect(map.off).toHaveBeenCalledWith('render', expect.any(Function));
  expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
});

it('opens an accessible trip popup and returns focus to the globe on close', async () => {
  render(<TravelGlobe {...atlas} />);
  act(() => map.on.mock.calls.find(([event]) => event === 'style.load')![1]());
  const onClick = map.on.mock.calls.find(([event, layer]) => event === 'click' && layer === 'trip-paris')![2];
  act(() => onClick({ features: [{ geometry: { type: 'Point', coordinates: [2.3522, 48.8566] }, properties: { count: 3 } }] }));
  expect(screen.getByRole('dialog', { name: 'Trip location' })).toHaveTextContent('3 photos at this location');
  expect(screen.getByRole('link', { name: 'Paris' })).toHaveAttribute('href', '/trips/paris');
  expect(screen.getByRole('link', { name: 'Paris' })).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Interactive globe with trip photo locations')).toHaveFocus();
});

it('allows pausing and resuming rotation', async () => {
  render(<TravelGlobe {...atlas} />);
  await userEvent.click(screen.getByRole('button', { name: 'Pause rotation' }));
  expect(screen.getByRole('button', { name: 'Resume rotation' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Resume rotation' }));
  expect(screen.getByRole('button', { name: 'Pause rotation' })).toHaveAttribute('aria-pressed', 'false');
});

it('keeps rotation disabled when reduced motion is requested', () => {
  media.matches = true;
  render(<TravelGlobe {...atlas} />);
  expect(screen.getByRole('button', { name: 'Resume rotation' })).toBeDisabled();
  expect(screen.getByText('Rotation off for reduced motion.')).toBeInTheDocument();
});
