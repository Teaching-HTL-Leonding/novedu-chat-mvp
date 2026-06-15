"use client";

import { useActionState, useRef, useState } from "react";
import { useCopyToClipboard } from "@/components/use-copy-to-clipboard";
import { ErrorList } from "@/components/validation-result";
import {
  addToDatetimeLocal,
  type DatetimeLocalUnit,
  datetimeLocalToUnixSeconds,
  nowAsDatetimeLocal,
} from "@/lib/datetime-local";
import { createTutorCodeAction, type TutorCodeFormState } from "@/lib/tutor-code-actions";
import formStyles from "../validate-tutor/validate-tutor.module.css";
import styles from "./share-tutor.module.css";

const INITIAL_STATE: TutorCodeFormState = { status: "idle" };

// A read-only link with its own Copy button and "Copied!" feedback.
function CopyableLinkRow({ link, label }: { link: string; label: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  // On a clipboard failure (non-secure context, e.g. plain http on a LAN
  // address) select the link so a manual Ctrl/Cmd+C is one keystroke away.
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
      <button type="button" className={formStyles.button} onClick={() => copy(link)}>
        {copied ? "Copied!" : "Copy"}
      </button>
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className={`${formStyles.button} ${styles.openLinkButton}`}
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

// Teacher-facing form that creates a Tutor Code. Storage and validation happen
// in the server action; this component only converts the datetime-local values
// (local wall-clock) into unix seconds — a conversion that MUST happen in the
// browser, the only place the teacher's timezone is known — and presents the
// resulting chat URL for easy copy-paste.
export function ShareTutorForm({ initialTutorUrl = "" }: { initialTutorUrl?: string }) {
  const [state, formAction, pending] = useActionState(createTutorCodeAction, INITIAL_STATE);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  // "+1h"/"+1d"/"+1w": extend the until time if it is set; otherwise start the
  // window length from the from time (or from now as a last resort).
  function extendEnd(amount: number, unit: DatetimeLocalUnit) {
    const base = end || start || nowAsDatetimeLocal();
    setEnd(addToDatetimeLocal(base, amount, unit));
  }

  return (
    <div className={formStyles.container}>
      {/*
        The tutor input is uncontrolled and named, with autocomplete on, so the
        browser records submitted values and offers them as a history next time.
      */}
      <form className={styles.form} action={formAction}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="share-tutor-url">
            Tutor YAML URL
          </label>
          <input
            id="share-tutor-url"
            type="url"
            name="tutor"
            required
            autoComplete="on"
            defaultValue={initialTutorUrl}
            className={formStyles.input}
            placeholder="https://example.com/path/to/tutor.yaml"
            disabled={pending}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="share-note">
            Note (optional — shown in your list of shared tutor codes)
          </label>
          <input
            id="share-note"
            type="text"
            name="note"
            maxLength={200}
            autoComplete="on"
            className={formStyles.input}
            placeholder="e.g. 3AHIF linked lists exercise"
            disabled={pending}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="share-start">
              Available from (your local time)
            </label>
            <div className={styles.inputRow}>
              <input
                id="share-start"
                type="datetime-local"
                name="start"
                required
                className={formStyles.input}
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
            <label className={styles.label} htmlFor="share-end">
              Available until (your local time)
            </label>
            <div className={styles.inputRow}>
              <input
                id="share-end"
                type="datetime-local"
                name="end"
                required
                className={formStyles.input}
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

        {/* What the server actually stores: the window as unix seconds (UTC). */}
        <input
          type="hidden"
          name="startTs"
          value={start ? datetimeLocalToUnixSeconds(start) : ""}
        />
        <input type="hidden" name="endTs" value={end ? datetimeLocalToUnixSeconds(end) : ""} />

        <button type="submit" className={formStyles.button} disabled={pending}>
          {pending ? "Creating…" : "Create Tutor Code"}
        </button>
      </form>

      <div className={formStyles.output}>
        {state.status === "error" && "message" in state ? (
          <p className={formStyles.requestError}>{state.message}</p>
        ) : null}
        {state.status === "error" && "errors" in state ? <ErrorList errors={state.errors} /> : null}
        {state.status === "success" ? (
          <section className={styles.linkBox}>
            <h2 className={styles.linkHeading}>Tutor Code</h2>
            <p className={formStyles.muted}>
              Send this link to your students — the last part of the URL is the tutor code, which
              they can also type in on the chat page. It only works within the chosen time window.
            </p>
            <CopyableLinkRow link={state.link} label="Tutor Code link" />
          </section>
        ) : null}
      </div>
    </div>
  );
}
