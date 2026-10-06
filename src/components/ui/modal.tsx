import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

export function Modal({ label, onClose, children, className = '', busy = false, initialFocusRef, returnFocusRef }: {
  label: string; onClose: () => void; children: ReactNode; className?: string; busy?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const opener = returnFocusRef?.current ?? dialog.ownerDocument.activeElement;
    // Close before React removes the dialog, so stacked dialogs retain their focus.
    dialog.showModal();
    initialFocusRef?.current?.focus();
    return () => {
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [initialFocusRef, returnFocusRef]);
  return <dialog ref={ref} tabIndex={-1} aria-label={label} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}
    className={`m-auto max-h-[100dvh] max-w-[100vw] border-0 bg-transparent p-4 backdrop:bg-black/80 ${className}`}>
    {children}
  </dialog>;
}
