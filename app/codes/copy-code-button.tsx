"use client";

import { CopyIconButton } from "@/components/copy-icon-button";

// The per-row copy affordance on the /codes list: every module's code is a regular
// activity URL now (coding included — a student visits it, signs in, and mints
// their own personal API key), so every row copies the `/<code>` share link. Built
// in the browser from window.location.origin (via the getter form), so it always
// matches wherever the teacher is currently working. This "use client" wrapper is
// the boundary that lets the closure read window.location — the list page itself
// is a server component, which cannot pass a function prop across the boundary.
export function CopyCodeButton({ code }: { code: string }) {
  return (
    <CopyIconButton
      text={() => `${window.location.origin}/${code}`}
      label="Copy link"
      promptLabel="Copy the chat link:"
    />
  );
}
