import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PhotoUploadForm } from './PhotoUploadForm';

const { enqueue, preview } = vi.hoisted(() => ({ enqueue: vi.fn(), preview: vi.fn() }));
vi.mock('../../lib/useUploadManager', () => ({ useUploadManager: () => ({ enqueue, preview }) }));
vi.mock('../../lib/groups', () => ({ errorMessage: (error: Error) => error.message }));
const NativeURL = URL;
beforeEach(() => {
  enqueue.mockReset().mockResolvedValue(undefined);
  preview.mockReset().mockResolvedValue(new Blob(['preview'], { type: 'image/png' }));
  let nextUrl = 0;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL = vi.fn(() => `blob:preview-${nextUrl++}`);
    static revokeObjectURL = vi.fn();
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const first = new File(['first'], 'first.jpg', { type: 'image/jpeg' });
const second = new File(['second'], 'second.png', { type: 'image/png' });
function mount() { return render(<PhotoUploadForm tripId="trip" />); }

it('opens the picker only from Choose files, including keyboard activation', async () => {
  mount();
  const picker = screen.getByLabelText('Add photos', { selector: 'input' });
  const openPicker = vi.spyOn(picker, 'click').mockImplementation(() => {});
  await userEvent.click(screen.getByRole('heading', { name: 'Add photos' }));
  await userEvent.click(screen.getByText(/Still JPEG/));
  await userEvent.click(screen.getByRole('form', { name: 'Add photos' }));
  expect(openPicker).not.toHaveBeenCalled();
  const choose = screen.getByRole('button', { name: 'Choose files' });
  expect(choose).toHaveClass('cursor-pointer');
  expect(picker).toHaveAttribute('hidden');
  await userEvent.click(choose);
  expect(openPicker).toHaveBeenCalledOnce();
  await userEvent.keyboard('{Enter}');
  expect(openPicker).toHaveBeenCalledTimes(2);
});
it('previews selections and removes a mistaken photo before uploading the remainder', async () => {
  mount();
  await userEvent.upload(screen.getByLabelText('Add photos', { selector: 'input' }), [first, second]);
  const firstUrl = screen.getByRole('img', { name: 'Preview of first.jpg' }).getAttribute('src');
  expect(screen.getByRole('img', { name: 'Preview of second.png' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload 2 photos' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Remove first.jpg' }));
  expect(screen.queryByRole('img', { name: 'Preview of first.jpg' })).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
  await userEvent.click(screen.getByRole('button', { name: 'Upload 1 photo' }));
  expect(enqueue).toHaveBeenCalledWith('trip', [second]);
  expect(await screen.findByRole('status')).toHaveTextContent('1 photo queued.');
  expect(screen.queryByRole('list', { name: 'Selected photos' })).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it('allows removing the last photo and selecting the same file again without refreshing', async () => {
  mount();
  await userEvent.upload(screen.getByLabelText('Add photos', { selector: 'input' }), first);
  await userEvent.click(screen.getByRole('button', { name: 'Remove first.jpg' }));
  expect(screen.getByRole('button', { name: 'Upload photos' })).toBeDisabled();
  await userEvent.upload(screen.getByLabelText('Add photos', { selector: 'input' }), first);
  expect(screen.getByRole('img', { name: 'Preview of first.jpg' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload 1 photo' })).toBeEnabled();
  expect(enqueue).not.toHaveBeenCalled();
});
it('adds subsequent selections to the current previews and releases all URLs on unmount', async () => {
  const { unmount } = mount();
  await userEvent.upload(screen.getByLabelText('Add photos', { selector: 'input' }), first);
  await userEvent.upload(screen.getByLabelText('Add photos', { selector: 'input' }), second);
  expect(screen.getAllByRole('img')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Upload 2 photos' })).toBeEnabled();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it('deduplicates the same File object within and across selections before enqueueing', async () => {
  mount();
  const picker = screen.getByLabelText('Add photos', { selector: 'input' });
  const original = new File(['photo'], 'repeat.jpg', { type: 'image/jpeg', lastModified: 100 });
  const repeated = original;
  await userEvent.upload(picker, [original, repeated]);
  await userEvent.upload(picker, [repeated, second]);
  expect(screen.getAllByRole('img')).toHaveLength(2);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole('button', { name: 'Upload 2 photos' }));
  expect(enqueue).toHaveBeenCalledWith('trip', [original, second]);
});
it('queues distinct photos with identical metadata within and across selections', async () => {
  mount();
  const picker = screen.getByLabelText('Add photos', { selector: 'input' });
  const options = { type: 'image/jpeg', lastModified: 100 };
  const original = new File(['first'], 'same.jpg', options);
  const different = new File(['other'], 'same.jpg', options);
  const later = new File(['third'], 'same.jpg', options);
  await userEvent.upload(picker, [original, different]);
  await userEvent.upload(picker, later);
  expect(screen.getAllByRole('img', { name: 'Preview of same.jpg' })).toHaveLength(3);
  await userEvent.click(screen.getByRole('button', { name: 'Upload 3 photos' }));
  expect(enqueue).toHaveBeenCalledWith('trip', [original, different, later]);
});
it('keeps photos with the same name but different metadata', async () => {
  mount();
  const original = new File(['photo'], 'same.jpg', { type: 'image/jpeg', lastModified: 100 });
  const resized = new File(['longer photo'], 'same.jpg', { type: 'image/jpeg', lastModified: 100 });
  const modified = new File(['photo'], 'same.jpg', { type: 'image/jpeg', lastModified: 200 });
  const differentType = new File(['photo'], 'same.jpg', { type: 'image/png', lastModified: 100 });
  await userEvent.upload(screen.getByLabelText('Add photos', { selector: 'input' }), [original, resized, modified, differentType]);
  await userEvent.click(screen.getByRole('button', { name: 'Upload 4 photos' }));
  expect(enqueue).toHaveBeenCalledWith('trip', [original, resized, modified, differentType]);
});
it('disables selection and removal while the photos are being queued', async () => {
  let finish!: () => void;
  enqueue.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  mount();
  await userEvent.upload(screen.getByLabelText('Add photos', { selector: 'input' }), first);
  await userEvent.click(screen.getByRole('button', { name: 'Upload 1 photo' }));
  expect(screen.getByRole('button', { name: 'Choose files' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove first.jpg' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Queueing…' })).toBeDisabled();
  await act(async () => finish());
  expect(screen.getByRole('button', { name: 'Choose files' })).toBeEnabled();
});
it('retains previews after an admission error so the selection can be removed or retried', async () => {
  enqueue.mockRejectedValueOnce(new Error('Queue unavailable'));
  mount();
  await userEvent.upload(screen.getByLabelText('Add photos', { selector: 'input' }), first);
  await userEvent.click(screen.getByRole('button', { name: 'Upload 1 photo' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Queue unavailable');
  expect(screen.getByRole('img', { name: 'Preview of first.jpg' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove first.jpg' })).toBeEnabled();
  await userEvent.click(screen.getByRole('button', { name: 'Upload 1 photo' }));
  expect(await screen.findByRole('status')).toHaveTextContent('1 photo queued.');
});
it('keeps removal available when the browser cannot preview a selected image', async () => {
  mount();
  await userEvent.upload(screen.getByLabelText('Add photos', { selector: 'input' }), first);
  fireEvent.error(screen.getByRole('img', { name: 'Preview of first.jpg' }));
  expect(screen.getByText('Preview unavailable')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Remove first.jpg' }));
  expect(screen.queryByText('Preview unavailable')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Upload photos' })).toBeDisabled();
});

it('shows a decoded HEIC preview and releases it on removal', async () => {
  let finish!: (blob: Blob) => void;
  preview.mockReturnValue(new Promise<Blob>(resolve => { finish = resolve; }));
  mount();
  const file = new File(['heic'], 'memory.heic', { type: 'image/heic' });
  await userEvent.upload(screen.getByLabelText('Add photos', { selector: 'input' }), file);
  expect(screen.getByRole('status')).toHaveTextContent('Preparing preview');
  const signal = preview.mock.calls[0][1] as AbortSignal;
  await act(async () => finish(new Blob(['decoded'], { type: 'image/png' })));
  expect(await screen.findByRole('img', { name: 'Preview of memory.heic' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Remove memory.heic' }));
  expect(signal.aborted).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-0');
});
it('aborts unfinished HEIC previews and ignores a result arriving after removal', async () => {
  let finish!: (blob: Blob) => void;
  preview.mockReturnValue(new Promise<Blob>(resolve => { finish = resolve; }));
  mount();
  await userEvent.upload(screen.getByLabelText('Add photos', { selector: 'input' }), new File(['heic'], 'memory.heic', { type: 'image/heic' }));
  const signal = preview.mock.calls[0][1] as AbortSignal;
  await userEvent.click(screen.getByRole('button', { name: 'Remove memory.heic' }));
  expect(signal.aborted).toBe(true);
  await act(async () => finish(new Blob(['late preview'], { type: 'image/png' })));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
it('provides a link to upload progress after queueing', async () => {
  mount();
  await userEvent.upload(screen.getByLabelText('Add photos', { selector: 'input' }), first);
  await userEvent.click(screen.getByRole('button', { name: 'Upload 1 photo' }));
  expect(screen.getByRole('link', { name: 'View upload progress' })).toHaveAttribute('href', '#photo-upload-progress');
});
