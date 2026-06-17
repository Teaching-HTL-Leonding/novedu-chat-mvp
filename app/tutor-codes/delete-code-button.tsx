"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TrashIcon } from "@/components/icons";
import { deleteTutorCodeAction } from "@/lib/tutor-code-actions";
import styles from "./tutor-codes.module.css";

// Deletes a tutor code AND all of its conversations — irreversible, so it asks
// first. On success the server action revalidates the list. By default
// router.refresh() pulls the updated server render so the row disappears without
// a full reload (the list page); pass `redirectTo` to navigate away instead
// (the edit page, whose code no longer exists after deletion).
export function DeleteCodeButton({
  code,
  label,
  redirectTo,
}: {
  code: string;
  label: string;
  redirectTo?: string;
}) {
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
