"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteTutorCodeAction } from "@/lib/tutor-code-actions";
import { TrashIcon } from "./icons";
import styles from "./tutor-codes.module.css";

// Deletes a tutor code AND all of its conversations — irreversible, so it asks
// first. On success the server action revalidates the list; router.refresh()
// pulls the updated server render so the row disappears without a full reload.
export function DeleteCodeButton({ code, label }: { code: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    const confirmed = window.confirm(
      `Delete "${label}" and ALL of its conversation data?\n\n` +
        "This permanently removes every conversation held under this tutor code. " +
        "It cannot be undone.",
    );
    if (!confirmed) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteTutorCodeAction(code);
      if (result.ok) {
        router.refresh();
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
        aria-label={`Delete tutor code ${label}`}
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
