"use client";

import { useActionState, useRef, useState } from "react";
import {
  addToDatetimeLocal,
  type DatetimeLocalUnit,
  datetimeLocalToUnixSeconds,
  nowAsDatetimeLocal,
} from "@/lib/datetime-local";
import { createShareLinkAction, type ShareLinkFormState } from "@/lib/share-link-actions";
import formStyles from "../validate-tutor/validate-tutor.module.css";
import styles from "./share-tutor.module.css";

const INITIAL_STATE: ShareLinkFormState = { status: "idle" };

// One read-only link with its own Copy button and "Copied!" feedback, so the
// full and the short link can be copied independently.
function CopyableLinkRow({ link, label }: { link: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (non-secure context, e.g. plain http on a
      // LAN address) or permission denied — select the link so a manual
      // Ctrl/Cmd+C is one keystroke away.
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

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
      <button type="button" className={formStyles.button} onClick={copyLink}>
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

// Teacher-facing form that creates a signed chat deep link. All signing happens
// in the server action; this component only converts the datetime-local values
// (local wall-clock) into unix seconds — a conversion that MUST happen in the
// browser, the only place the teacher's timezone is known — and presents the
// resulting link for easy copy-paste.
export function ShareTutorForm() {
  const [state, formAction, pending] = useActionState(createShareLinkAction, INITIAL_STATE);
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
            className={formStyles.input}
            placeholder="https://example.com/path/to/tutor.yaml"
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

        {/* What the server actually signs: the window as unix seconds (UTC). */}
        <input
          type="hidden"
          name="startTs"
          value={start ? datetimeLocalToUnixSeconds(start) : ""}
        />
        <input type="hidden" name="endTs" value={end ? datetimeLocalToUnixSeconds(end) : ""} />

        <button type="submit" className={formStyles.button} disabled={pending}>
          {pending ? "Creating…" : "Create Share Link"}
        </button>
      </form>

      <div className={formStyles.output}>
        {state.status === "error" ? (
          <p className={formStyles.requestError}>{state.message}</p>
        ) : null}
        {state.status === "success" ? (
          <section className={styles.linkBox}>
            <h2 className={styles.linkHeading}>Share link</h2>
            <p className={formStyles.muted}>
              Send this link to your students. It only works within the chosen time window.
            </p>
            <CopyableLinkRow link={state.link} label="Share link" />
            {state.shortLink ? (
              <>
                <p className={formStyles.muted}>Or use the short link — it opens the same chat.</p>
                <CopyableLinkRow link={state.shortLink} label="Short link" />
              </>
            ) : null}
            {state.warning ? <p className={formStyles.warning}>{state.warning}</p> : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
