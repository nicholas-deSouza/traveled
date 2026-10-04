import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parisPhoto, parisTrip } from '../../test/fixtures';
import { MemoryRouter } from 'react-router-dom';
import { TravelGlobe } from './TravelGlobe';

const map = vi.hoisted(() => ({
  addControl: vi.fn(), on: vi.fn(), off: vi.fn(), setProjection: vi.fn(),
  addSource: vi.fn(), addLayer: vi.fn(), remove: vi.fn(),
  project: vi.fn(() => ({ x: 120, y: 160 })),
  isStyleLoaded: vi.fn(() => true), getZoom: vi.fn(() => 1.15),
  getLayer: vi.fn(() => ({})), queryRenderedFeatures: vi.fn(() => [] as unknown[]),
}));
vi.mock('../../lib/groups', () => ({ downloadPhoto: vi.fn(async () => new Blob(['thumbnail'])) }));
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
  map.getZoom.mockReturnValue(1.15);
  map.queryRenderedFeatures.mockReturnValue([]);
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:thumbnail');
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => vi.unstubAllGlobals());

it('plots located photos per trip and releases map resources on unmount', () => {
  const { unmount } = render(<MemoryRouter><TravelGlobe {...atlas} /></MemoryRouter>);
  expect(screen.getByLabelText('Interactive globe with trip photo locations')).toBeInTheDocument();
  const onLoad = map.on.mock.calls.find(([event]) => event === 'style.load')![1];
  act(() => onLoad());
  expect(map.setProjection).toHaveBeenCalledWith({ type: 'globe' });
  expect(map.addSource).toHaveBeenCalledWith('trip-paris', expect.objectContaining({
    cluster: false,
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

it('keeps Los Angeles and San Francisco independent while grouping identical photo coordinates', () => {
  const photos = [
    { ...parisPhoto, id: 'la-one', latitude: 34.0522, longitude: -118.2437 },
    { ...parisPhoto, id: 'la-two', latitude: 34.0522, longitude: -118.2437 },
    { ...parisPhoto, id: 'sf', latitude: 37.7749, longitude: -122.4194 },
  ];
  render(<MemoryRouter><TravelGlobe trips={[parisTrip]} photos={photos} /></MemoryRouter>);
  act(() => map.on.mock.calls.find(([event]) => event === 'style.load')![1]());
  expect(map.addSource).toHaveBeenCalledWith('trip-paris', {
    type: 'geojson', cluster: false,
    data: { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { count: 2, representative: 0 }, geometry: { type: 'Point', coordinates: [-118.2437, 34.0522] } },
      { type: 'Feature', properties: { count: 1, representative: 2 }, geometry: { type: 'Point', coordinates: [-122.4194, 37.7749] } },
    ] },
  });
});

it('renders independent city thumbnails at close zoom, deduplicates tile features, and hides them when zooming out', async () => {
  const photos = [
    { ...parisPhoto, id: 'la', storage_path: 'la.webp', latitude: 34.0522, longitude: -118.2437 },
    { ...parisPhoto, id: 'sf', storage_path: 'sf.webp', latitude: 37.7749, longitude: -122.4194 },
  ];
  render(<MemoryRouter><TravelGlobe trips={[parisTrip]} photos={photos} /></MemoryRouter>);
  act(() => map.on.mock.calls.find(([event]) => event === 'style.load')![1]());
  const renderMap = map.on.mock.calls.find(([event]) => event === 'render')![1];
  const la = { geometry: { type: 'Point', coordinates: [-118.2437, 34.0522] }, properties: { count: 1, representative: 0 } };
  const sf = { geometry: { type: 'Point', coordinates: [-122.4194, 37.7749] }, properties: { count: 1, representative: 1 } };
  map.getZoom.mockReturnValue(5);
  map.queryRenderedFeatures.mockReturnValue([la, sf, la]);
  await act(async () => renderMap());
  const markers = screen.getAllByRole('link', { name: 'Paris: 1 photos. Open trip' });
  expect(markers).toHaveLength(2);
  expect(markers[0].style.transform).not.toBe(markers[1].style.transform);
  expect(map.project).toHaveBeenCalledWith([-118.2437, 34.0522]);
  expect(map.project).toHaveBeenCalledWith([-122.4194, 37.7749]);
  expect(screen.getAllByRole('presentation')).toHaveLength(2);
  map.getZoom.mockReturnValue(4.99);
  act(() => renderMap());
  expect(screen.queryByRole('link', { name: 'Paris: 1 photos. Open trip' })).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

it('opens an accessible trip popup and returns focus to the globe on close', async () => {
  render(<MemoryRouter><TravelGlobe {...atlas} /></MemoryRouter>);
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
  render(<MemoryRouter><TravelGlobe {...atlas} /></MemoryRouter>);
  await userEvent.click(screen.getByRole('button', { name: 'Pause rotation' }));
  expect(screen.getByRole('button', { name: 'Resume rotation' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Resume rotation' }));
  expect(screen.getByRole('button', { name: 'Pause rotation' })).toHaveAttribute('aria-pressed', 'false');
});

it('keeps rotation disabled when reduced motion is requested', () => {
  media.matches = true;
  render(<MemoryRouter><TravelGlobe {...atlas} /></MemoryRouter>);
  expect(screen.getByRole('button', { name: 'Resume rotation' })).toBeDisabled();
  expect(screen.getByText('Rotation off for reduced motion.')).toBeInTheDocument();
});

it('identifies grouped locations and expands them instead of claiming one location', async () => {
  const expansion = vi.fn().mockResolvedValue(8);
  map.getSource.mockReturnValue({ getClusterExpansionZoom: expansion });
  render(<MemoryRouter><TravelGlobe {...atlas} /></MemoryRouter>);
  act(() => map.on.mock.calls.find(([event]) => event === 'style.load')![1]());
  expect(map.addLayer.mock.calls.every(([layer]) => layer.type !== 'symbol')).toBe(true);
  const click = map.on.mock.calls.find(([event, layer]) => event === 'click' && layer === 'trip-paris')![2];
  act(() => click({ features: [{ geometry: { type: 'Point', coordinates: [2, 48] }, properties: { count: 3, cluster: true, cluster_id: 42 } }] }));
  expect(screen.getByRole('dialog')).toHaveTextContent('3 photos across grouped locations');
  expect(screen.getByRole('dialog')).not.toHaveTextContent('at this location');
  await userEvent.click(screen.getByRole('button', { name: 'Show locations' }));
  await waitFor(() => expect(map.easeTo).toHaveBeenCalledWith({ center: [2, 48], zoom: 8, duration: 600 }));
  expect(expansion).toHaveBeenCalledWith(42);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps failed expansion recoverable and avoids moving after the popup closes', async () => {
  let reject!: (reason: Error) => void;
  const expansion = vi.fn().mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  map.getSource.mockReturnValue({ getClusterExpansionZoom: expansion });
  render(<MemoryRouter><TravelGlobe {...atlas} /></MemoryRouter>);
  act(() => map.on.mock.calls.find(([event]) => event === 'style.load')![1]());
  const click = map.on.mock.calls.find(([event, layer]) => event === 'click' && layer === 'trip-paris')![2];
  act(() => click({ features: [{ geometry: { type: 'Point', coordinates: [2, 48] }, properties: { count: 3, cluster: true, cluster_id: 42 } }] }));
  await userEvent.click(screen.getByRole('button', { name: 'Show locations' }));
  expect(screen.getByRole('button', { name: 'Zooming…' })).toBeDisabled();
  await act(async () => reject(new Error('Unavailable')));
  expect(screen.getByRole('alert')).toHaveTextContent('Could not expand this group');
  let resolve!: (zoom: number) => void;
  expansion.mockImplementation(() => new Promise(done => { resolve = done; }));
  await userEvent.click(screen.getByRole('button', { name: 'Show locations' }));
  await userEvent.click(screen.getByRole('button', { name: 'Close' }));
  await act(async () => resolve(8));
  expect(map.easeTo).not.toHaveBeenCalled();
});

it('does not place a representative photo thumbnail at an averaged cluster location', () => {
  map.queryRenderedFeatures.mockReturnValue([{ geometry: { type: 'Point', coordinates: [2, 48] }, properties: { count: 3, cluster: true, cluster_id: 42, representative: 0 } }]);
  render(<MemoryRouter><TravelGlobe {...atlas} /></MemoryRouter>);
  act(() => map.on.mock.calls.find(([event]) => event === 'render')![1]());
  expect(screen.queryByRole('link', { name: /photos. Open trip/ })).not.toBeInTheDocument();
});

it('keeps a newer expansion loading when an older request settles', async () => {
  const pending: ((zoom: number) => void)[] = [];
  map.getSource.mockReturnValue({ getClusterExpansionZoom: vi.fn(() => new Promise<number>(resolve => pending.push(resolve))) });
  render(<MemoryRouter><TravelGlobe {...atlas} /></MemoryRouter>);
  act(() => map.on.mock.calls.find(([event]) => event === 'style.load')![1]());
  const click = map.on.mock.calls.find(([event, layer]) => event === 'click' && layer === 'trip-paris')![2];
  const select = (id: number) => act(() => click({ features: [{ geometry: { type: 'Point', coordinates: [id, 48] }, properties: { count: 3, cluster: true, cluster_id: id } }] }));
  select(42);
  await userEvent.click(screen.getByRole('button', { name: 'Show locations' }));
  select(43);
  await userEvent.click(screen.getByRole('button', { name: 'Show locations' }));
  await act(async () => pending[0](8));
  expect(screen.getByRole('button', { name: 'Zooming…' })).toBeDisabled();
  expect(map.easeTo).not.toHaveBeenCalled();
  await act(async () => pending[1](9));
  expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [43, 48], zoom: 9 }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('renders font-independent cluster counts and opens groups with the keyboard at low zoom', async () => {
  map.getZoom.mockReturnValueOnce(2);
  map.queryRenderedFeatures.mockReturnValue([{ geometry: { type: 'Point', coordinates: [2, 48] }, properties: { count: 12, cluster: true, cluster_id: 42 } }]);
  render(<MemoryRouter><TravelGlobe {...atlas} /></MemoryRouter>);
  act(() => map.on.mock.calls.find(([event]) => event === 'render')![1]());
  const cluster = screen.getByRole('button', { name: 'Paris: 12 photos across grouped locations. Explore group' });
  expect(cluster).toHaveTextContent('12');
  cluster.focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('dialog')).toHaveTextContent('12 photos across grouped locations');
  await userEvent.keyboard('{Escape}');
  cluster.focus();
  await userEvent.keyboard(' ');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('Numbered circles group photos across locations. Select one to explore.')).toHaveClass('pointer-events-none');
});
