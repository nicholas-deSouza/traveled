import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import maplibregl from 'maplibre-gl';
import { PhotoLocationMap } from './PhotoLocationMap';

const { map, marker } = vi.hoisted(() => ({
  map: { on: vi.fn(), addControl: vi.fn(), jumpTo: vi.fn(), getZoom: vi.fn(() => 1), remove: vi.fn() },
  marker: { on: vi.fn(), setLngLat: vi.fn(), addTo: vi.fn(), setDraggable: vi.fn(), remove: vi.fn(), getLngLat: vi.fn(() => ({ lat: 10, lng: 190 })) },
}));
vi.mock('maplibre-gl', () => ({ default: {
  Map: vi.fn(function () { return map; }), Marker: vi.fn(function () { return marker; }), NavigationControl: vi.fn(),
} }));
beforeEach(() => { marker.setLngLat.mockReturnValue(marker); marker.addTo.mockReturnValue(marker); });

it('lets a user choose a point and refine a draggable pin, including wrapped longitude', () => {
  const onChange = vi.fn();
  const { rerender, unmount } = render(<PhotoLocationMap location={null} onChange={onChange} disabled={false} />);
  const click = map.on.mock.calls.find(([name]) => name === 'click')![1];
  act(() => click({ lngLat: { lat: 0, lng: 0 } }));
  expect(onChange).toHaveBeenCalledWith({ latitude: 0, longitude: 0 });
  rerender(<PhotoLocationMap location={{ latitude: 0, longitude: 0 }} onChange={onChange} disabled={false} />);
  expect(marker.setLngLat).toHaveBeenCalledWith([0, 0]);
  expect(marker.addTo).toHaveBeenCalledWith(map);
  act(() => marker.on.mock.calls.find(([name]) => name === 'dragend')![1]());
  expect(onChange).toHaveBeenLastCalledWith({ latitude: 10, longitude: -170 });
  rerender(<PhotoLocationMap location={{ latitude: 0, longitude: 0 }} onChange={onChange} disabled />);
  onChange.mockClear();
  act(() => click({ lngLat: { lat: 20, lng: 30 } }));
  expect(onChange).not.toHaveBeenCalled();
  expect(marker.setDraggable).toHaveBeenLastCalledWith(false);
  unmount();
  expect(map.remove).toHaveBeenCalledOnce();
});

it('offers search and coordinate entry when WebGL cannot start', () => {
  vi.mocked(maplibregl.Map).mockImplementationOnce(function () { throw new Error('No WebGL'); });
  render(<PhotoLocationMap location={null} onChange={vi.fn()} disabled={false} />);
  expect(screen.getByRole('status')).toHaveTextContent('Use place search or enter coordinates');
});
