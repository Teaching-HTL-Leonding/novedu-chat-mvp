"use client";

import { type FormEvent, useState, useTransition } from "react";
import { BackLink } from "@/components/back-link";
import { ErrorList } from "@/components/validation-result";
import { createFileAction } from "@/lib/files-actions";
import type { ValidationError } from "@/lib/tutors";
import styles from "../files.module.css";
import { YamlEditor } from "../yaml-editor";

// Create form: name + kind + the CodeMirror editor (with an upload button). Name,
// kind, and content are controlled state — and the form submits via `onSubmit`
// (not a React form `action`), so a rejected save keeps everything the teacher
// entered instead of being wiped by React's post-action form reset. On success
// the action redirects to the edit page; on failure it shows either a short
// message or the full structured validator errors.
export function CreateFileForm() {
  const [name, setName] = useState("");
  const [kind, setKind] = useState("tutor");
  const [content, setContent] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<ValidationError[] | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setErrors(null);
    startTransition(async () => {
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
        Create a hosted YAML file. It is validated on creation — an invalid tutor or fragment is
        rejected.
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
              onChange={(event) => setName(event.target.value)}
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
              onChange={(event) => setKind(event.target.value)}
              className={styles.select}
              disabled={pending}
            >
              <option value="tutor">Tutor</option>
              <option value="fragment">Fragment</option>
            </select>
          </div>
        </div>

        <YamlEditor value={content} onChange={setContent} disabled={pending} />

        <div className={styles.actionsBar}>
          <button type="submit" className={styles.button} disabled={pending}>
            {pending ? "Creating…" : "Create file"}
          </button>
          {message ? <p className={styles.requestError}>{message}</p> : null}
        </div>

        {errors ? <ErrorList errors={errors} /> : null}
      </form>
    </div>
  );
}
