"use client";

import { type FormEvent, useState, useTransition } from "react";
import { BackLink } from "@/components/back-link";
import { ErrorList, WarningList } from "@/components/validation-result";
import { createFileAction, validateNewFileAction } from "@/lib/files-actions";
import type { ValidationError, ValidationWarning } from "@/lib/tutors";
import styles from "../files.module.css";
import { YamlEditor } from "../yaml-editor";

// Create form: name + kind + the CodeMirror editor (with an upload button). Name,
// kind, and content are controlled state — and the form submits via `onSubmit`
// (not a React form `action`), so a rejected save keeps everything the teacher
// entered instead of being wiped by React's post-action form reset.
//
// Two actions share the form: a standalone "Validate" checks the YAML WITHOUT
// storing (so teachers stop saving throwaway versions just to validate), and
// "Validate & create" validates again server-side and stores. Any edit clears the
// validate feedback so a stale "passed" note never lingers. On a successful create
// the action redirects to the edit page; failures show a short message or the full
// structured validator errors.
export function CreateFileForm() {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("tutor");
  const [content, setContent] = useState("");
  const [validating, startValidate] = useTransition();
  const [saving, startSave] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<ValidationError[] | null>(null);
  const [warnings, setWarnings] = useState<ValidationWarning[] | null>(null);
  const [passed, setPassed] = useState(false);
  const pending = validating || saving;

  // Clear every validation outcome — called when starting an action and whenever
  // the buffer changes (so the result always reflects the CURRENT content).
  function resetFeedback() {
    setMessage(null);
    setErrors(null);
    setWarnings(null);
    setPassed(false);
  }

  function onValidate() {
    resetFeedback();
    startValidate(async () => {
      const result = await validateNewFileAction({ name, kind, content });
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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedback();
    startSave(async () => {
      const result = await createFileAction({ name, kind, content });
      // A successful create redirects (the action calls redirect()); only a
      // failure returns here.
      if ("errors" in result) setErrors(result.errors);
      else setMessage(result.message);
    });
  }

  return (
    <div className={styles.container}>
      <BackLink href="/files">Back to files</BackLink>
      <p className={styles.hint}>
        Create a hosted YAML file. Use <strong>Validate</strong> to check it without saving;{" "}
        <strong>Validate &amp; create</strong> stores it — an invalid tutor or fragment is rejected.
      </p>

      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.fieldRow}>
          <div className={`${styles.field} ${styles.fieldGrow}`}>
            <label className={styles.label} htmlFor="file-name">
              Name (letters, digits, underscore, hyphen — no spaces)
            </label>
            <input
              id="file-name"
              required
              maxLength={100}
              pattern="[A-Za-z0-9_-]+"
              autoComplete="off"
              className={styles.input}
              placeholder="e.g. linked-lists-tutor"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                resetFeedback();
              }}
              disabled={pending}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="file-kind">
              Kind
            </label>
            <select
              id="file-kind"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value);
                resetFeedback();
              }}
              className={styles.select}
              disabled={pending}
            >
              <option value="tutor">Tutor</option>
              <option value="fragment">Fragment</option>
            </select>
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
          <button type="submit" className={styles.button} disabled={pending}>
            {saving ? "Creating…" : "Validate & create"}
          </button>
          {message ? <p className={styles.requestError}>{message}</p> : null}
          {passed && !message && !errors ? (
            <span className={styles.saved}>Validation passed</span>
          ) : null}
        </div>

        {errors ? <ErrorList errors={errors} /> : null}
        {passed && warnings && warnings.length > 0 ? <WarningList warnings={warnings} /> : null}
      </form>
    </div>
  );
}
