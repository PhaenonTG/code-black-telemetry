import { useEffect, useId, useRef, type ReactNode } from "react";

export function PhoneSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="ops-phone-sheet" aria-labelledby={titleId} onCancel={onClose} onClose={onClose}>
    <header><h2 id={titleId}>{title}</h2><button type="button" onClick={onClose} aria-label={`Close ${title}`}>Close</button></header>
    <div className="ops-phone-sheet__body">{open ? children : null}</div>
  </dialog>;
}
