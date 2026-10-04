"use client";

import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

// A toggle over server-rendered content: the wrapper carries `data-expanded`,
// and the parts to reveal are hidden with `HIDDEN_UNTIL_EXPANDED`-style classes
// (`group-data-[expanded=true]/disclosure:…`). Used by "How XP works" and
// "Show all badges"; the button sits before or after the content.
export function Disclosure({
  label,
  expandedLabel = label,
  controls,
  buttonPlacement = "end",
  buttonClassName,
  className,
  children,
}: {
  label: string;
  expandedLabel?: string;
  /** Id of the element whose content the toggle reveals. */
  controls: string;
  buttonPlacement?: "start" | "end";
  buttonClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const button = (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={() => setExpanded((open) => !open)}
      className={buttonClassName}
    >
      {expanded ? expandedLabel : label}
    </button>
  );
  return (
    <div className={cn("group/disclosure", className)} data-expanded={expanded}>
      {buttonPlacement === "start" ? button : null}
      {children}
      {buttonPlacement === "end" ? button : null}
    </div>
  );
}
