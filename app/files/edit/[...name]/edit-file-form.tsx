"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BackLink } from "@/components/back-link";
import { CopyIconButton } from "@/components/copy-icon-button";
import { ErrorList } from "@/components/validation-result";
import { updateFileAction } from "@/lib/files-actions";
import type { ValidationError } from "@/lib/tutors";
import { DeleteFileButton } from "../../delete-file-button";
import styles from "../../files.module.css";
import { YamlEditor } from "../../yaml-editor";

// Edit form: read-only name/kind + the copyable public URL + the CodeMirror
// editor preloaded with the active version's content. Save creates a new version
// (validated server-side; an invalid save is rejected and the specific validator
// errors are shown). Delete soft-deletes and returns to the list.
export function EditFileForm({
  name,
  kind,
  initialContent,
  publicUrl,
}: {
  name: string;
  kind: string;
  initialContent: string;
  publicUrl: string;
}) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<ValidationError[] | null>(null);
  const [saved, setSaved] = useState(false);

  function onSave() {
    setMessage(null);
    setErrors(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateFileAction(name, content);
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else if ("errors" in result) {
        setErrors(result.errors);
      } else {
        setMessage(result.message);
      }
    });
  }

  return (
    <div className={styles.container}>
      <BackLink href="/files">Back to files</BackLink>

      <div className={styles.readonlyMeta}>
        <span>
          Name: <code>{name}</code>
        </span>
        <span>
          Kind: <code>{kind}</code>
        </span>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Public URL (use this in a tutor code)</span>
        <div className={styles.urlRow}>
          <input
            className={styles.urlInput}
            readOnly
            value={publicUrl}
            aria-label="Public file URL"
            onFocus={(event) => event.currentTarget.select()}
          />
          <CopyIconButton
            text={publicUrl}
            label="Copy URL"
            className={styles.iconButton}
            promptLabel="Copy the file URL:"
          />
        </div>
      </div>

      <YamlEditor value={content} onChange={setContent} disabled={pending} />

      <div className={styles.actionsBar}>
        <button type="button" className={styles.button} onClick={onSave} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <DeleteFileButton name={name} redirectTo="/files" />
        {message ? <p className={styles.requestError}>{message}</p> : null}
        {saved && !message && !errors ? <span className={styles.saved}>Saved</span> : null}
      </div>

      {errors ? <ErrorList errors={errors} /> : null}
    </div>
  );
}
