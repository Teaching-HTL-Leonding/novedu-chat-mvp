"use client";

import { useState } from "react";

// The single clipboard-copy primitive: write text, flash a transient "copied"
// flag, and on failure (insecure context / permission denied) run an optional
// per-call fallback. Shared by every copy affordance (icon copy buttons, the
// share-link row, the code-block copy button) so the success timing and the
// secure-context fallback live in ONE place instead of drifting across copies.

interface CopyOptions {
  /** How long `copied` stays true after a successful copy. */
  resetMs?: number;
  /** Run when the Clipboard API is unavailable/denied (e.g. show a prompt, select an input). */
  onFail?: (text: string) => void;
}

export function useCopyToClipboard({ resetMs = 2000, onFail }: CopyOptions = {}) {
  const [copied, setCopied] = useState(false);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), resetMs);
    } catch {
      onFail?.(text);
    }
  }

  return { copied, copy };
}
