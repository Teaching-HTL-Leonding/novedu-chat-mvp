"use client";

import { CheckIcon, CopyIcon } from "@/components/icons";
import { useCopyToClipboard } from "@/components/use-copy-to-clipboard";

// Square icon button that copies text to the clipboard, swapping to a check mark
// while the copy is fresh. The caller supplies the shared `.iconButton`
// className so it matches whatever toolbar/row it sits in. `text` may be a getter
// so callers that build the value at click time (e.g. from window.location) need
// no SSR guard. The accessible label doubles as the resting tooltip.
export function CopyIconButton({
  text,
  label,
  className,
  promptLabel,
}: {
  text: string | (() => string);
  label: string;
  /** The shared `.iconButton` class from the caller's CSS module. */
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
      className={className}
      onClick={() => copy(typeof text === "function" ? text() : text)}
      aria-label={label}
      title={copied ? "Copied!" : label}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
