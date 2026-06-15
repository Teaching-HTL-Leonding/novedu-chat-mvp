"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TrashIcon } from "@/components/icons";
import { deleteFileAction } from "@/lib/files-actions";
import styles from "./files.module.css";

// Soft-deletes a hosted file (it leaves history behind, but the GET endpoint
// stops serving it and it drops out of the list). Confirms first since it pulls
// the file out of circulation. On success the action revalidates the list; the
// list row uses router.refresh() (the row disappears), while the edit page passes
// `redirectTo="/files"` to navigate away from the now-deleted file.
export function DeleteFileButton({ name, redirectTo }: { name: string; redirectTo?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    const confirmed = window.confirm(
      `Delete "${name}"?\n\n` +
        "It stops being served and disappears from this list. The version history " +
        "(including this deletion) is kept.",
    );
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteFileAction(name);
      if (result.ok) {
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.iconButton} ${styles.iconButtonDanger}`}
        onClick={onDelete}
        disabled={pending}
        aria-label={`Delete file ${name}`}
        title="Delete"
      >
        <TrashIcon />
      </button>
      {error ? (
        <span role="alert" className={styles.deleteError}>
          {error}
        </span>
      ) : null}
    </>
  );
}
