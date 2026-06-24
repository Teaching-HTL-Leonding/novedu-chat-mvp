"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TrashIcon } from "@/components/icons";
import { deleteImageAction } from "@/lib/images-actions";
import styles from "./images.module.css";

// Soft-deletes a hosted image (it leaves history behind, but it drops out of the
// list and its backing blob is removed). Confirms first since it pulls the image
// out of circulation. On success the action revalidates the list; the row uses
// router.refresh() so the row disappears.
export function DeleteImageButton({ name, redirectTo }: { name: string; redirectTo?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    const confirmed = window.confirm(
      `Delete "${name}"?\n\n` +
        "It disappears from this list and its stored file is removed. The version " +
        "history (including this deletion) is kept.",
    );
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteImageAction(name);
      if (result.ok) {
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        setError("The image could not be deleted. Try again.");
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
        aria-label={`Delete image ${name}`}
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
