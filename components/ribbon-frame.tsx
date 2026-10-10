import type { ReactNode } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

// The coloured strip under the status bar that names where this page runs — the
// shared markup of the hostname-based environment ribbon
// (components/environment-ribbon.tsx, client) and a demo build's DEMO ribbon
// (components/demo-ribbon.tsx, server). Hook-free, so it renders on either side.
export function RibbonFrame({
  label,
  className,
  children,
  onDismiss,
}: {
  label: string;
  className: string;
  children: ReactNode;
  /** Renders the "×" control; without it the ribbon cannot be hidden. */
  onDismiss?: () => void;
}) {
  return (
    <aside
      aria-label="Environment"
      className={cn("flex shrink-0 items-center gap-3 px-5 py-1.5 text-sm", className)}
    >
      <p className="min-w-0 flex-1">
        <strong className="font-bold">{label}</strong> · {children}
      </p>
      {onDismiss && (
        <IconButton
          aria-label="Hide this notice"
          onClick={onDismiss}
          className="size-6 border-0 text-base not-disabled:hover:bg-current/15"
        >
          ×
        </IconButton>
      )}
    </aside>
  );
}
