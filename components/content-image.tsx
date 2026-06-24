"use client";

import { useState } from "react";
import type { ResolvedImage } from "@/lib/image-ref";
import styles from "./content-image.module.css";
import { ImageLightbox } from "./image-lightbox";

// Module-neutral content image. Renders a bounded responsive thumbnail (a real
// button) that opens the shared <ImageLightbox> showing the same image full-window.
// Images are rendered ONLY via <img src> — never inline SVG markup — so a hosted
// SVG can't inject script into the page. If the thumbnail <img> fails to load, the
// component falls back to a muted note.
export function ContentImage({ image }: { image: ResolvedImage }) {
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const alt = image.alt ?? "";

  if (failed) {
    return <p className={styles.note}>Image could not be loaded</p>;
  }

  return (
    <>
      {/* The thumbnail and its credit are grouped in a figure sized to the image
          (width: fit-content), so the credit aligns to the image's width rather
          than the full column. */}
      <figure className={styles.figure}>
        <button
          type="button"
          className={styles.thumbButton}
          aria-label="View larger image"
          onClick={() => setOpen(true)}
        >
          {/* biome-ignore lint/performance/noImgElement: hosted images are arbitrary external blobs (incl. SVG), not bundled assets — next/image's optimizer/loader doesn't apply. */}
          <img className={styles.thumb} src={image.url} alt={alt} onError={() => setFailed(true)} />
        </button>
        {image.credit ? <figcaption className={styles.credit}>{image.credit}</figcaption> : null}
      </figure>

      <ImageLightbox image={image} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
