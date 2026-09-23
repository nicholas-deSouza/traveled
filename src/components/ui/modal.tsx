import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

export function Modal({ label, onClose, children, className = '', busy = false, initialFocusRef }: {
  label: string; onClose: () => void; children: ReactNode; className?: string; busy?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    // Native modal dialogs provide background inertness, focus containment and restoration.
    dialog.showModal();
    initialFocusRef?.current?.focus();
    return () => dialog.close();
  }, [initialFocusRef]);
  return <dialog ref={ref} tabIndex={-1} aria-label={label} aria-busy={busy}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}
    className={`m-auto max-h-[100dvh] max-w-[100vw] border-0 bg-transparent p-4 backdrop:bg-black/80 ${className}`}>
    {children}
  </dialog>;
}
