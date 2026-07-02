"use client";

import { useState } from "react";
import { DialogShell } from "@/components/ui/dialog-shell";
import type { ResolvedImage } from "@/lib/image-ref";

// The shared image lightbox: the app's DialogShell (which owns open/close,
// Escape, backdrop click, and the Close button) sized to the image. Images are
// rendered ONLY via <img src> — never inline SVG markup — so a hosted SVG can't
// inject script. Reused by <ContentImage> (the quiz / tutor / fragment content
// image) and by the /images list's "View" button, so both surfaces get the
// identical lightbox.
export function ImageLightbox({
  image,
  open,
  onClose,
}: {
  image: ResolvedImage;
  open: boolean;
  onClose: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const alt = image.alt ?? "";

  return (
    // h-auto / w-auto: the dialog hugs the image; the caps keep it inside the
    // viewport, and min-h-0 lets the image shrink within the flex column so
    // the credit line stays visible below tall images.
    <DialogShell open={open} onClose={onClose} className="h-auto max-h-[88vh] w-auto max-w-[92vw]">
      {failed ? (
        <p className="px-10 py-8 text-foreground/55 text-sm">Image could not be loaded</p>
      ) : (
        // biome-ignore lint/performance/noImgElement: hosted images are arbitrary external blobs (incl. SVG), not bundled assets — next/image's optimizer/loader doesn't apply.
        <img
          className="block min-h-0 max-w-full object-contain"
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
    </DialogShell>
  );
}
