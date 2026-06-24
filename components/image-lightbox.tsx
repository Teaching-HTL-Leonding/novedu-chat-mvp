"use client";

import { useEffect, useRef, useState } from "react";
import type { ResolvedImage } from "@/lib/image-ref";
import styles from "./image-lightbox.module.css";

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
      className={styles.dialog}
      onClose={onClose}
      onCancel={onClose}
      // Clicking the backdrop (the dialog element itself, not its content) closes it.
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className={styles.dialogInner}>
        <div className={styles.dialogHeader}>
          <button type="button" className={styles.closeButton} onClick={onClose}>
            Close
          </button>
        </div>
        {failed ? (
          <p className={styles.note}>Image could not be loaded</p>
        ) : (
          // biome-ignore lint/performance/noImgElement: hosted images are arbitrary external blobs (incl. SVG), not bundled assets — next/image's optimizer/loader doesn't apply.
          <img className={styles.full} src={image.url} alt={alt} onError={() => setFailed(true)} />
        )}
        {image.credit ? <p className={styles.dialogCredit}>{image.credit}</p> : null}
      </div>
    </dialog>
  );
}
