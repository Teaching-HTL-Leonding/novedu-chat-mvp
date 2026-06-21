"use client";

import { useActionState, useRef, useState } from "react";
import { useCopyToClipboard } from "@/components/use-copy-to-clipboard";
import {
  addToDatetimeLocal,
  type DatetimeLocalUnit,
  datetimeLocalToUnixSeconds,
  nowAsDatetimeLocal,
} from "@/lib/datetime-local";
import { createQuizLinkAction, type QuizLinkFormState } from "@/lib/quiz-link-actions";
// Shared form styling — the share-quiz form is the same visual family as the
// tutor-code form (URL + availability window + a copyable link).
import styles from "../tutor-codes/tutor-code-form.module.css";

const INITIAL_STATE: QuizLinkFormState = { status: "idle" };

// A read-only link with its own Copy button + "Copied!" feedback. On a clipboard
// failure (insecure context, e.g. plain http on a LAN address) the link is
// selected so a manual Ctrl/Cmd+C is one keystroke away.
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
    </div>
  );
}

// Teacher-facing form that mints a SIGNED quiz deep link. All signing happens in
// the server action; this component only converts the datetime-local values
// (local wall-clock) into unix seconds — a conversion that MUST happen in the
// browser, the only place the teacher's timezone is known — and presents the
// resulting link for easy copy-paste.
export function ShareQuizForm({ initialQuizUrl = "" }: { initialQuizUrl?: string }) {
  const [state, formAction, pending] = useActionState(createQuizLinkAction, INITIAL_STATE);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  // "+1h"/"+1d"/"+1w": extend the until time if set; otherwise start the window
  // length from the from time (or from now as a last resort).
  function extendEnd(amount: number, unit: DatetimeLocalUnit) {
    const base = end || start || nowAsDatetimeLocal();
    setEnd(addToDatetimeLocal(base, amount, unit));
  }

  return (
    <div className={styles.container}>
      <form className={styles.form} action={formAction}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="share-quiz-url">
            Quiz YAML URL
          </label>
          <input
            id="share-quiz-url"
            type="url"
            name="quiz"
            required
            autoComplete="on"
            defaultValue={initialQuizUrl}
            className={styles.input}
            placeholder="https://example.com/api/files/my-quiz"
            disabled={pending}
          />
        </div>

        <div className={styles.row}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="share-quiz-start">
              Available from (your local time)
            </label>
            <div className={styles.inputRow}>
              <input
                id="share-quiz-start"
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
            <label className={styles.label} htmlFor="share-quiz-end">
              Available until (your local time)
            </label>
            <div className={styles.inputRow}>
              <input
                id="share-quiz-end"
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

        {/* What the server signs: the window as unix seconds (UTC). */}
        <input
          type="hidden"
          name="startTs"
          value={start ? datetimeLocalToUnixSeconds(start) : ""}
        />
        <input type="hidden" name="endTs" value={end ? datetimeLocalToUnixSeconds(end) : ""} />

        <div className={styles.actionsBar}>
          <button type="submit" className={styles.button} disabled={pending}>
            {pending ? "Creating…" : "Create quiz link"}
          </button>
        </div>
      </form>

      <div className={styles.output}>
        {state.status === "error" ? <p className={styles.requestError}>{state.message}</p> : null}
        {state.status === "success" ? (
          <section className={styles.linkBox}>
            <h2 className={styles.linkHeading}>Quiz link</h2>
            <p className={styles.muted}>
              Send this link to your students. It only works within the chosen time window.
            </p>
            <CopyableLinkRow link={state.link} label="Quiz link" />
          </section>
        ) : null}
      </div>
    </div>
  );
}
