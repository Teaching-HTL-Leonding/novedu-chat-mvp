"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BackLink } from "@/components/back-link";
import { CopyIconButton } from "@/components/copy-icon-button";
import { ErrorList, WarningList } from "@/components/validation-result";
import { updateFileAction, validateExistingFileAction } from "@/lib/files-actions";
import type { ValidationError, ValidationWarning } from "@/lib/tutors";
import { DeleteFileButton } from "../../delete-file-button";
import styles from "../../files.module.css";
import { YamlEditor } from "../../yaml-editor";

// Edit form: read-only name/kind + the copyable public URL + the CodeMirror
// editor preloaded with the active version's content. "Validate" checks the YAML
// WITHOUT saving (so teachers stop creating throwaway versions just to validate),
// and "Validate & save" validates again server-side and stores a new version (an
// invalid save is rejected with the specific validator errors). Any edit clears
// the validate feedback. Delete soft-deletes and returns to the list.
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
  const [validating, startValidate] = useTransition();
  const [saving, startSave] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<ValidationError[] | null>(null);
  const [warnings, setWarnings] = useState<ValidationWarning[] | null>(null);
  const [passed, setPassed] = useState(false);
  const [saved, setSaved] = useState(false);
  const pending = validating || saving;

  // Clear every transient outcome — on starting an action and on every edit, so
  // the feedback always reflects the CURRENT buffer.
  function resetFeedback() {
    setMessage(null);
    setErrors(null);
    setWarnings(null);
    setPassed(false);
    setSaved(false);
  }

  function onValidate() {
    resetFeedback();
    startValidate(async () => {
      const result = await validateExistingFileAction(name, content);
      if (result.ok) {
        setPassed(true);
        setWarnings(result.warnings);
      } else if ("errors" in result) {
        setErrors(result.errors);
      } else {
        setMessage(result.message);
      }
    });
  }

  function onSave() {
    resetFeedback();
    startSave(async () => {
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

      <YamlEditor
        value={content}
        onChange={(value) => {
          setContent(value);
          resetFeedback();
        }}
        disabled={pending}
      />

      <div className={styles.actionsBar}>
        <button
          type="button"
          className={styles.uploadButton}
          onClick={onValidate}
          disabled={pending}
        >
          {validating ? "Validating…" : "Validate"}
        </button>
        <button type="button" className={styles.button} onClick={onSave} disabled={pending}>
          {saving ? "Saving…" : "Validate & save"}
        </button>
        <DeleteFileButton name={name} redirectTo="/files" />
        {message ? <p className={styles.requestError}>{message}</p> : null}
        {saved && !message && !errors ? <span className={styles.saved}>Saved</span> : null}
        {passed && !saved && !message && !errors ? (
          <span className={styles.saved}>Validation passed</span>
        ) : null}
      </div>

      {errors ? <ErrorList errors={errors} /> : null}
      {passed && warnings && warnings.length > 0 ? <WarningList warnings={warnings} /> : null}
    </div>
  );
}
