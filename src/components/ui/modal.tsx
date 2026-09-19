import { useEffect, useRef, type ReactNode } from 'react';

let openDialogs = 0;
let originalOverflow = '';

export function Modal({ label, onClose, children, className = '', busy = false }: {
  label: string; onClose: () => void; children: ReactNode; className?: string; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openDialogs++ === 0) originalOverflow = document.body.style.overflow;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      if (--openDialogs === 0) document.body.style.overflow = originalOverflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return <dialog ref={ref} tabIndex={-1} aria-label={label} aria-busy={busy}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const dialog = event.currentTarget;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )).filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault(); dialog.focus();
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault(); first.focus();
      }
    }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}
    className={`m-auto max-h-[100dvh] max-w-[100vw] border-0 bg-transparent p-4 backdrop:bg-black/80 ${className}`}>
    {children}
  </dialog>;
}
