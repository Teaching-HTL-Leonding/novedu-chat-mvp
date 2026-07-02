"use client";

import { CheckIcon, CopyIcon } from "@/components/icons";
import { iconButtonVariants } from "@/components/ui/icon-button";
import { useCopyToClipboard } from "@/components/use-copy-to-clipboard";
import { cn } from "@/lib/utils";

// Square icon button that copies text to the clipboard, swapping to a check mark
// while the copy is fresh. Carries the shared icon-button recipe itself; the
// optional className is a cn-merged delta. `text` may be a getter so callers that
// build the value at click time (e.g. from window.location) need no SSR guard.
// The accessible label doubles as the resting tooltip.
export function CopyIconButton({
  text,
  label,
  className,
  promptLabel,
}: {
  text: string | (() => string);
  label: string;
  className?: string;
  /** When set, a failed copy falls back to a `window.prompt` with this message. */
  promptLabel?: string;
}) {
  const { copied, copy } = useCopyToClipboard({
    onFail: promptLabel ? (value) => window.prompt(promptLabel, value) : undefined,
  });

  return (
    <button
      type="button"
      className={cn(iconButtonVariants(), className)}
      onClick={() => copy(typeof text === "function" ? text() : text)}
      aria-label={label}
      title={copied ? "Copied!" : label}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
