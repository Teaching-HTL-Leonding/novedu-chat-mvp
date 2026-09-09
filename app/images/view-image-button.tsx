"use client";

import { useState } from "react";
import { EyeIcon } from "@/components/icons";
import { ImageLightbox } from "@/components/image-lightbox";
import { IconButton } from "@/components/ui/icon-button";

// The list row's "View" action: an icon button that opens the image full-window in
// the SAME <ImageLightbox> the quiz / tutor content images use. `url` is the app's
// own byte route for that image version (`/api/image-content/<id>`), which the
// browser fetches with the session cookie it already carries.
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
