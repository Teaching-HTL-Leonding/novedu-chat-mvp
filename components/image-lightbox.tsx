"use client";

import { useEffect, useRef, useState } from "react";
import type { ResolvedImage } from "@/lib/image-ref";
import { Button } from "./ui/button";

// The shared image lightbox: a native <dialog> that shows one image full-window.
// `open` drives showModal()/close(); the dialog also closes on Escape, the Close
// button, and a backdrop click — each routed back through `onClose` so the caller
// stays the single source of open/closed truth. Images are rendered ONLY via
// <img src> — never inline SVG markup — so a hosted SVG can't inject script.
// Reused by <ContentImage> (the quiz / tutor / fragment content image) and by the
// /images list's "View" button, so both surfaces get the identical lightbox.
export function ImageLightbox({
  image,
  open,
  onClose,
}: {
  image: ResolvedImage;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const alt = image.alt ?? "";

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss is mouse-only; the native <dialog> already closes on Escape (onClose/onCancel), and the Close button covers keyboard users.
    <dialog
      ref={dialogRef}
      // m-auto restores the UA's margin:auto top-layer centering that preflight
      // resets — every native <dialog> in the app needs it.
      className="m-auto max-h-[88vh] max-w-[92vw] overflow-hidden rounded-xl border border-foreground/15 bg-background text-foreground backdrop:bg-foreground/45"
      onClose={onClose}
      onCancel={onClose}
      // Clicking the backdrop (the dialog element itself, not its content) closes it.
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="flex flex-col">
        <div className="flex items-center justify-end border-foreground/15 border-b p-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        {failed ? (
          <p className="px-10 py-8 text-foreground/55 text-sm">Image could not be loaded</p>
        ) : (
          // biome-ignore lint/performance/noImgElement: hosted images are arbitrary external blobs (incl. SVG), not bundled assets — next/image's optimizer/loader doesn't apply.
          <img
            className="block max-h-[88vh] max-w-[92vw] object-contain"
            src={image.url}
            alt={alt}
            onError={() => setFailed(true)}
          />
        )}
        {image.credit ? (
          <p className="wrap-anywhere px-2.5 pt-1.5 pb-2.5 text-center text-foreground/60 text-xs">
            {image.credit}
          </p>
        ) : null}
      </div>
    </dialog>
  );
}
