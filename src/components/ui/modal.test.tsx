import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import { Modal } from './modal';

const prototype = HTMLDialogElement.prototype;
const originalShowModal = Object.getOwnPropertyDescriptor(prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(prototype, 'close');
const showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true; });
const close = vi.fn(function (this: HTMLDialogElement) { this.open = false; });

// jsdom does not implement native dialog opening/closing. Stub only those APIs;
// browser-managed focus trapping and background inertness need browser tests.
beforeEach(() => {
  Object.defineProperties(prototype, {
    showModal: { configurable: true, writable: true, value: showModal },
    close: { configurable: true, writable: true, value: close },
  });
});
afterAll(() => {
  if (originalShowModal) Object.defineProperty(prototype, 'showModal', originalShowModal);
  else Reflect.deleteProperty(prototype, 'showModal');
  if (originalClose) Object.defineProperty(prototype, 'close', originalClose);
  else Reflect.deleteProperty(prototype, 'close');
});

it('opens an accessible dialog with its content and closes on unmount', () => {
  const { unmount } = render(<Modal label="Edit trip" onClose={vi.fn()} className="w-full"><p>Trip settings</p></Modal>);
  const dialog = screen.getByRole('dialog', { name: 'Edit trip' });
  expect(dialog).toHaveTextContent('Trip settings');
  expect(dialog).toHaveAttribute('open');
  expect(dialog).toHaveAttribute('aria-busy', 'false');
  expect(dialog).toHaveClass('w-full');
  expect(showModal).toHaveBeenCalledOnce();
  unmount();
  expect(close).toHaveBeenCalledOnce();
  expect(dialog).not.toHaveAttribute('open');
});

it('focuses the requested initial control', () => {
  const initialFocusRef = createRef<HTMLInputElement>();
  render(<Modal label="Edit trip" onClose={vi.fn()} initialFocusRef={initialFocusRef}>
    <label>Trip name<input ref={initialFocusRef} /></label>
  </Modal>);
  expect(screen.getByRole('textbox', { name: 'Trip name' })).toHaveFocus();
});

it('handles native cancellation without allowing the browser to close independently', () => {
  const onClose = vi.fn();
  render(<Modal label="Edit trip" onClose={onClose}>Settings</Modal>);
  const cancel = new Event('cancel', { cancelable: true });
  fireEvent(screen.getByRole('dialog'), cancel);
  expect(cancel.defaultPrevented).toBe(true);
  expect(onClose).toHaveBeenCalledOnce();
});

it('dismisses backdrop clicks but not clicks on content', async () => {
  const onClose = vi.fn();
  render(<Modal label="Edit trip" onClose={onClose}><button>Inside</button></Modal>);
  await userEvent.click(screen.getByRole('button', { name: 'Inside' }));
  expect(onClose).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('dialog'));
  expect(onClose).toHaveBeenCalledOnce();
});

it('blocks cancellation and backdrop dismissal while busy, then allows dismissal', async () => {
  const onClose = vi.fn();
  const { rerender } = render(<Modal label="Edit trip" onClose={onClose} busy>Saving</Modal>);
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveAttribute('aria-busy', 'true');
  const cancel = new Event('cancel', { cancelable: true });
  fireEvent(dialog, cancel);
  await userEvent.click(dialog);
  expect(cancel.defaultPrevented).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  rerender(<Modal label="Edit trip" onClose={onClose}>Saved</Modal>);
  expect(dialog).toHaveAttribute('aria-busy', 'false');
  expect(showModal).toHaveBeenCalledOnce();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(onClose).toHaveBeenCalledOnce();
});
