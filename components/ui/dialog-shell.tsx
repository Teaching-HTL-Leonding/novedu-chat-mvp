"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The app's single modal: a native <dialog> (writing lightboxes, quiz
// discussion, teacher transcript, image lightbox). DialogShell owns the whole
// behavior contract — showModal()/close() driven by the `open` prop, closing on
// Escape, backdrop click, and the header's Close button, all routed through
// `onClose` so the caller stays the single source of open/closed truth.
//
// The shell is a flex COLUMN: DIALOG_BODY (flex-1) fills and scrolls without
// any per-consumer wrapper. `open:flex` — never a bare `flex` — because an
// author `display` beats the UA's `dialog:not([open]) { display: none }`, and a
// closed dialog would render inline. `m-auto` is load-bearing — Tailwind
// preflight zeroes the UA dialog margin that centers native modals in the top
// layer. `className` is a cn-merged size delta (e.g. "h-auto max-h-[85vh]").
const SHELL =
  "m-auto h-[80vh] w-[min(48rem,92vw)] flex-col overflow-hidden rounded-xl border border-foreground/15 bg-background p-0 text-foreground open:flex backdrop:bg-foreground/45";

const HEADER = "flex items-center justify-between gap-4 border-foreground/15 border-b px-4 py-3";

// The scrolling content region for text-like dialogs; image-like content
// renders as bare children instead and sizes itself against the flex column.
export const DIALOG_BODY = "min-h-0 flex-1 overflow-y-auto p-4";

export function DialogShell({
  open,
  onClose,
  title,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // No unmount cleanup, deliberately: the browser drops an unmounted open
  // dialog from the top layer by itself, and a cleanup close() would fire a
  // REAL close event during StrictMode's simulated mount cycle — a dialog
  // that mounts already open would tell its parent to close it again.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss is mouse-only; the native <dialog> already closes on Escape (onCancel/onClose), and the header Close button covers keyboard users.
    <dialog
      ref={dialogRef}
      className={cn(SHELL, className)}
      onClose={onClose}
      onCancel={onClose}
      // Clicking the backdrop (the dialog element itself, not its content) closes it.
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className={HEADER}>
        {/* The empty span keeps Close right-aligned when there is no title. */}
        {title != null ? <h3 className="font-semibold text-base">{title}</h3> : <span />}
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
      {children}
    </dialog>
  );
}
