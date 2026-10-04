"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { InfoIcon } from "@/components/icons";
import { TOOLTIP_SURFACE } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// The "Outside school hours" column's explanation: an info button with a
// tooltip that opens on hover and keyboard focus, stays open while the pointer
// moves onto it, and closes on Escape (WCAG 1.4.13: hoverable, dismissible).

/** How long the tooltip waits before closing, so the pointer can cross the gap onto it. */
const TIP_GRACE_MS = 150;

export function SchoolHoursTip() {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelHide = useCallback(() => clearTimeout(hideTimer.current), []);
  const show = () => {
    cancelHide();
    setOpen(true);
  };
  const hideSoon = () => {
    cancelHide();
    hideTimer.current = setTimeout(() => setOpen(false), TIP_GRACE_MS);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => cancelHide, [cancelHide]);

  return (
    <span className="relative inline-flex" onPointerEnter={show} onPointerLeave={hideSoon}>
      <button
        type="button"
        aria-label="What counts as outside school hours"
        aria-describedby={tipId}
        onFocus={show}
        onBlur={() => setOpen(false)}
        className="inline-flex size-5 cursor-help items-center justify-center rounded-full text-foreground/60 hover:bg-foreground/5 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
      >
        <InfoIcon className="size-3.5" />
      </button>
      <span
        id={tipId}
        role="tooltip"
        hidden={!open}
        className={cn(
          TOOLTIP_SURFACE,
          // In a table head: undo its uppercase, tracking, weight and nowrap.
          "absolute top-full right-0 z-10 mt-1.5 w-max max-w-72 whitespace-normal text-left font-normal normal-case tracking-normal",
        )}
      >
        The share of this activity's interactions on weekends, or Monday to Friday before 8:00 or
        from 17:00 (Vienna time). Counted by whole hours; school holidays are not taken into
        account.
      </span>
    </span>
  );
}
