"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "./icons";
import styles from "./tutor-codes.module.css";

// Copies the full chat URL for a tutor code. The absolute URL is built in the
// browser from window.location.origin — codes are origin-independent, so the
// copied link always matches wherever the teacher is currently working. Icon
// button; the accessible label stays "Copy link" so it reads clearly (and the
// e2e finds it by that name).
export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const link = `${window.location.origin}/${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (non-secure context) or permission denied —
      // fall back to the prompt-free select-nothing behavior: show the link so
      // it can be copied manually.
      window.prompt("Copy the chat link:", link);
    }
  }

  return (
    <button
      type="button"
      className={styles.iconButton}
      onClick={copy}
      aria-label="Copy link"
      title={copied ? "Copied!" : "Copy link"}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}
