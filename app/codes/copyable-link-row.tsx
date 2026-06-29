"use client";

import { useRef } from "react";
import { useCopyToClipboard } from "@/components/use-copy-to-clipboard";
import styles from "./code-form.module.css";

// A read-only link with its own Copy button and "Copied!" feedback (+ open in a
// new tab). On a clipboard failure (non-secure context, e.g. plain http on a LAN
// address) the link is selected so a manual Ctrl/Cmd+C is one keystroke away.
export function CopyableLinkRow({ link, label }: { link: string; label: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { copied, copy } = useCopyToClipboard({
    onFail: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  });

  return (
    <div className={styles.linkRow}>
      <input
        ref={inputRef}
        className={styles.linkInput}
        readOnly
        value={link}
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
      />
      <button type="button" className={styles.button} onClick={() => copy(link)}>
        {copied ? "Copied!" : "Copy"}
      </button>
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className={`${styles.button} ${styles.openLinkButton}`}
        aria-label={`Open ${label} in new tab`}
        title="Open in new tab"
      >
        <svg
          width="1em"
          height="1em"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
        >
          <title>Open in new tab</title>
          <path d="M15 3h6v6" />
          <path d="M10 14 21 3" />
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        </svg>
      </a>
    </div>
  );
}
