"use client";

import { useActionState, useRef, useState } from "react";
import { BackLink } from "@/components/back-link";
import { useCopyToClipboard } from "@/components/use-copy-to-clipboard";
import { ErrorList } from "@/components/validation-result";
import {
  addToDatetimeLocal,
  type DatetimeLocalUnit,
  datetimeLocalToUnixSeconds,
  nowAsDatetimeLocal,
  unixSecondsToDatetimeLocal,
} from "@/lib/datetime-local";
import {
  createTutorCodeAction,
  type TutorCodeFormState,
  updateTutorCodeAction,
} from "@/lib/tutor-code-actions";
import { DeleteCodeButton } from "./delete-code-button";
import styles from "./tutor-code-form.module.css";

const INITIAL_STATE: TutorCodeFormState = { status: "idle" };

// A read-only link with its own Copy button and "Copied!" feedback (+ open in a
// new tab). On a clipboard failure (non-secure context, e.g. plain http on a LAN
// address) the link is selected so a manual Ctrl/Cmd+C is one keystroke away.
function CopyableLinkRow({ link, label }: { link: string; label: string }) {
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

export interface TutorCodeFormProps {
  mode: "create" | "edit";
  /** Editable in create mode; shown read-only (never submitted) in edit mode. */
  initialTutorUrl?: string;
  initialNote?: string;
  initialStartSeconds?: number;
  initialEndSeconds?: number;
  /** Edit mode only: the code being edited + its shareable chat URL. */
  code?: string;
  shareUrl?: string;
}

// One form for BOTH creating and editing a Tutor Code. Validation + storage live
// in the server actions; this only converts the datetime-local values (local
// wall-clock) to unix seconds — a conversion that MUST happen in the browser, the
// only place the teacher's timezone is known. Create redirects to the new code's
// edit page on success (which shows the shareable link). Edit changes the
// note/window only — the tutor URL is frozen (shown read-only), so there is no
// YAML re-validation.
export function TutorCodeForm({
  mode,
  initialTutorUrl = "",
  initialNote = "",
  initialStartSeconds,
  initialEndSeconds,
  code,
  shareUrl,
}: TutorCodeFormProps) {
  const isEdit = mode === "edit";
  const action: (state: TutorCodeFormState, formData: FormData) => Promise<TutorCodeFormState> =
    isEdit ? updateTutorCodeAction.bind(null, code ?? "") : createTutorCodeAction;
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const [start, setStart] = useState(
    initialStartSeconds ? unixSecondsToDatetimeLocal(initialStartSeconds) : "",
  );
  const [end, setEnd] = useState(
    initialEndSeconds ? unixSecondsToDatetimeLocal(initialEndSeconds) : "",
  );

  // "+1h"/"+1d"/"+1w": extend the until time if set; otherwise start the window
  // length from the from time (or from now as a last resort).
  function extendEnd(amount: number, unit: DatetimeLocalUnit) {
    const base = end || start || nowAsDatetimeLocal();
    setEnd(addToDatetimeLocal(base, amount, unit));
  }

  return (
    <div className={styles.container}>
      <BackLink href="/tutor-codes">Back to tutor codes</BackLink>

      {isEdit && shareUrl ? (
        <section className={styles.linkBox}>
          <h2 className={styles.linkHeading}>Tutor Code link</h2>
          <p className={styles.muted}>
            Send this link to your students — the last part of the URL is the tutor code, which they
            can also type on the chat page. It only works within the chosen time window.
          </p>
          <CopyableLinkRow link={shareUrl} label="Tutor Code link" />
        </section>
      ) : null}

      <form className={styles.form} action={formAction}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="tutor-code-url">
            Tutor YAML URL
          </label>
          {isEdit ? (
            <input
              id="tutor-code-url"
              type="url"
              className={styles.readonlyUrl}
              readOnly
              value={initialTutorUrl}
              aria-label="Tutor YAML URL (read-only)"
              title="The tutor URL cannot be changed — create a new code to share a different tutor."
            />
          ) : (
            <input
              id="tutor-code-url"
              type="url"
              name="tutor"
              required
              autoComplete="on"
              defaultValue={initialTutorUrl}
              className={styles.input}
              placeholder="https://example.com/path/to/tutor.yaml"
              disabled={pending}
            />
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="tutor-code-note">
            Note (optional — shown in the list of shared tutor codes)
          </label>
          <input
            id="tutor-code-note"
            type="text"
            name="note"
            maxLength={200}
            autoComplete="on"
            defaultValue={initialNote}
            className={styles.input}
            placeholder="e.g. 3AHIF linked lists exercise"
            disabled={pending}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tutor-code-start">
              Available from (your local time)
            </label>
            <div className={styles.inputRow}>
              <input
                id="tutor-code-start"
                type="datetime-local"
                name="start"
                required
                className={styles.input}
                value={start}
                onChange={(event) => setStart(event.target.value)}
                disabled={pending}
              />
              <button
                type="button"
                className={styles.quickButton}
                onClick={() => setStart(nowAsDatetimeLocal())}
                disabled={pending}
              >
                Now
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="tutor-code-end">
              Available until (your local time)
            </label>
            <div className={styles.inputRow}>
              <input
                id="tutor-code-end"
                type="datetime-local"
                name="end"
                required
                className={styles.input}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                disabled={pending}
              />
              <button
                type="button"
                className={styles.quickButton}
                onClick={() => extendEnd(1, "hours")}
                disabled={pending}
              >
                +1h
              </button>
              <button
                type="button"
                className={styles.quickButton}
                onClick={() => extendEnd(1, "days")}
                disabled={pending}
              >
                +1d
              </button>
              <button
                type="button"
                className={styles.quickButton}
                onClick={() => extendEnd(1, "weeks")}
                disabled={pending}
              >
                +1w
              </button>
            </div>
          </div>
        </div>

        {/* What the server stores: the window as unix seconds (UTC). */}
        <input
          type="hidden"
          name="startTs"
          value={start ? datetimeLocalToUnixSeconds(start) : ""}
        />
        <input type="hidden" name="endTs" value={end ? datetimeLocalToUnixSeconds(end) : ""} />

        <div className={styles.actionsBar}>
          <button type="submit" className={styles.button} disabled={pending}>
            {pending
              ? isEdit
                ? "Saving…"
                : "Creating…"
              : isEdit
                ? "Save changes"
                : "Create Tutor Code"}
          </button>
          {isEdit && state.status === "saved" ? <span className={styles.saved}>Saved</span> : null}
          {isEdit && code ? (
            <DeleteCodeButton code={code} label={initialNote || code} redirectTo="/tutor-codes" />
          ) : null}
        </div>
      </form>

      <div className={styles.output}>
        {state.status === "error" && "message" in state ? (
          <p className={styles.requestError}>{state.message}</p>
        ) : null}
        {state.status === "error" && "errors" in state ? <ErrorList errors={state.errors} /> : null}
      </div>
    </div>
  );
}
