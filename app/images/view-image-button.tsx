"use client";

import { useState } from "react";
import { EyeIcon } from "@/components/icons";
import { ImageLightbox } from "@/components/image-lightbox";
import { IconButton } from "@/components/ui/icon-button";

// The list row's "View" action: an icon button that opens the image full-window in
// the SAME <ImageLightbox> the quiz / tutor content images use. `url` is the row's
// short-lived read SAS (minted on the server — no app route serves image bytes).
export function ViewImageButton({
  name,
  url,
  credit,
}: {
  name: string;
  url: string;
  credit: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton onClick={() => setOpen(true)} aria-label={`View image ${name}`} title="View">
        <EyeIcon />
      </IconButton>
      <ImageLightbox
        image={{ url, alt: name, credit: credit ?? undefined }}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
