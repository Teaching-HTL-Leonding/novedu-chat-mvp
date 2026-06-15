"use client";

import { CopyIconButton } from "@/components/copy-icon-button";
import styles from "./tutor-codes.module.css";

// Copies the full chat URL for a tutor code. The absolute URL is built in the
// browser from window.location.origin (via the getter form) — codes are
// origin-independent, so the copied link always matches wherever the teacher is
// currently working. The accessible label stays "Copy link" so it reads clearly
// (and the e2e finds it by that name).
export function CopyCodeButton({ code }: { code: string }) {
  return (
    <CopyIconButton
      text={() => `${window.location.origin}/${code}`}
      label="Copy link"
      className={styles.iconButton}
      promptLabel="Copy the chat link:"
    />
  );
}
