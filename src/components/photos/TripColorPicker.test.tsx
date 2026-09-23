import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { updateTripColor, type Trip } from '../../lib/groups';
import { TripColorPicker } from './TripColorPicker';

vi.mock('../../lib/groups', () => ({
  updateTripColor: vi.fn(),
  errorMessage: (error: Error) => error.message,
}));

const trip: Trip = {
  id: 'trip-1', group_id: 'friends', created_by: 'owner', color: '#123456',
  title: 'Paris', description: null, starts_on: null, ends_on: null,
};

beforeEach(() => { vi.mocked(updateTripColor).mockReset(); });

it('shows the trip color without editing controls for read-only viewers', () => {
  render(<TripColorPicker trip={trip} canEdit={false} />);
  expect(screen.getByText('Trip color')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Choose trip color')).not.toBeInTheDocument();
});

it('opens with the saved color and discards canceled edits', async () => {
  render(<TripColorPicker trip={trip} canEdit />);
  await userEvent.click(screen.getByRole('button', { name: 'Change color' }));
  expect(screen.getByLabelText('Choose trip color')).toHaveValue('#123456');
  // Color inputs use a native picker that jsdom/user-event cannot operate.
  fireEvent.change(screen.getByLabelText('Choose trip color'), { target: { value: '#abcdef' } });
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Choose trip color')).not.toBeInTheDocument();
  expect(updateTripColor).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Change color' }));
  expect(screen.getByLabelText('Choose trip color')).toHaveValue('#123456');
});

it('saves a selected color and uses it when editing again', async () => {
  vi.mocked(updateTripColor).mockResolvedValue(undefined);
  render(<TripColorPicker trip={trip} canEdit />);
  await userEvent.click(screen.getByRole('button', { name: 'Change color' }));
  fireEvent.change(screen.getByLabelText('Choose trip color'), { target: { value: '#abcdef' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(updateTripColor).toHaveBeenCalledExactlyOnceWith('trip-1', '#abcdef');
  expect(await screen.findByRole('button', { name: 'Change color' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Change color' }));
  expect(screen.getByLabelText('Choose trip color')).toHaveValue('#abcdef');
});

it('disables editing and duplicate saves until the request finishes', async () => {
  let finish!: () => void;
  vi.mocked(updateTripColor).mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  render(<TripColorPicker trip={trip} canEdit />);
  await userEvent.click(screen.getByRole('button', { name: 'Change color' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByLabelText('Choose trip color')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  const saving = screen.getByRole('button', { name: 'Saving…' });
  expect(saving).toBeDisabled();
  await userEvent.click(saving);
  expect(updateTripColor).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(screen.getByRole('button', { name: 'Change color' })).toBeEnabled();
});

it('preserves the draft after an error and allows retrying', async () => {
  vi.mocked(updateTripColor).mockRejectedValueOnce(new Error('Unable to save')).mockResolvedValue(undefined);
  render(<TripColorPicker trip={trip} canEdit />);
  await userEvent.click(screen.getByRole('button', { name: 'Change color' }));
  fireEvent.change(screen.getByLabelText('Choose trip color'), { target: { value: '#abcdef' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save');
  expect(screen.getByLabelText('Choose trip color')).toHaveValue('#abcdef');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('button', { name: 'Change color' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(updateTripColor).toHaveBeenCalledTimes(2);
});

it('clears failed edits on cancel and restores the saved color', async () => {
  vi.mocked(updateTripColor).mockRejectedValue(new Error('Unable to save'));
  render(<TripColorPicker trip={trip} canEdit />);
  await userEvent.click(screen.getByRole('button', { name: 'Change color' }));
  fireEvent.change(screen.getByLabelText('Choose trip color'), { target: { value: '#abcdef' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Change color' }));
  expect(screen.getByLabelText('Choose trip color')).toHaveValue('#123456');
});
