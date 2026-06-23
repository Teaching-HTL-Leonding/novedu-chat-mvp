"use client";

import { useActionState, useRef, useState } from "react";
import { BackLink } from "@/components/back-link";
import { useCopyToClipboard } from "@/components/use-copy-to-clipboard";
import { ErrorList } from "@/components/validation-result";
import { type CodeFormState, createCodeAction, updateCodeAction } from "@/lib/code-actions";
import { CODE_MODULES, type CodeModule, codeModuleLabels } from "@/lib/code-modules/types";
import {
  addToDatetimeLocal,
  type DatetimeLocalUnit,
  datetimeLocalToUnixSeconds,
  nowAsDatetimeLocal,
  unixSecondsToDatetimeLocal,
} from "@/lib/datetime-local";
import styles from "./code-form.module.css";
import { DeleteCodeButton } from "./delete-code-button";

const INITIAL_STATE: CodeFormState = { status: "idle" };

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

export interface CodeFormProps {
  mode: "create" | "edit";
  /** Create: preselects the activity. Edit: the row's module (shown read-only). */
  initialModule?: CodeModule;
  /** Editable in create mode; shown read-only (never submitted) in edit mode. */
  initialFileUrl?: string;
  initialNote?: string;
  initialStartSeconds?: number;
  initialEndSeconds?: number;
  /** Edit mode only: the code being edited + its shareable URL. */
  code?: string;
  shareUrl?: string;
}

// One form for BOTH creating and editing a code. Validation + storage live in the
// server actions; this only converts the datetime-local values (local wall-clock)
// to unix seconds — a conversion that MUST happen in the browser, the only place
// the teacher's timezone is known. Create picks the activity (`module`) + file and
// redirects to the new code's edit page on success (which shows the shareable
// link). Edit changes the note/window only — the module + file URL are frozen
// (shown read-only), so there is no YAML re-validation.
export function CodeForm({
  mode,
  initialModule = "tutor",
  initialFileUrl = "",
  initialNote = "",
  initialStartSeconds,
  initialEndSeconds,
  code,
  shareUrl,
}: CodeFormProps) {
  const isEdit = mode === "edit";
  const action: (state: CodeFormState, formData: FormData) => Promise<CodeFormState> = isEdit
    ? updateCodeAction.bind(null, code ?? "")
    : createCodeAction;
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
      <BackLink href="/codes">Back to codes</BackLink>

      {isEdit && shareUrl ? (
        <section className={styles.linkBox}>
          <h2 className={styles.linkHeading}>Share link</h2>
          <p className={styles.muted}>
            Send this link to your students — the last part of the URL is the code, which they can
            also type on the start page. It only works within the chosen time window.
          </p>
          <CopyableLinkRow link={shareUrl} label="Share link" />
        </section>
      ) : null}

      <form className={styles.form} action={formAction}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="code-module">
            Activity
          </label>
          {isEdit ? (
            <input
              id="code-module"
              type="text"
              className={styles.readonlyUrl}
              readOnly
              value={codeModuleLabels[initialModule].badge}
              aria-label="Activity (read-only)"
              title="The activity cannot be changed — create a new code for a different activity."
            />
          ) : (
            <select
              id="code-module"
              name="module"
              defaultValue={initialModule}
              className={styles.input}
              disabled={pending}
            >
              {CODE_MODULES.map((m) => (
                <option key={m} value={m}>
                  {codeModuleLabels[m].badge}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="code-url">
            Activity YAML URL
          </label>
          {isEdit ? (
            <input
              id="code-url"
              type="url"
              className={styles.readonlyUrl}
              readOnly
              value={initialFileUrl}
              aria-label="Activity YAML URL (read-only)"
              title="The file URL cannot be changed — create a new code to share a different file."
            />
          ) : (
            <input
              id="code-url"
              type="url"
              name="file"
              required
              autoComplete="on"
              defaultValue={initialFileUrl}
              className={styles.input}
              placeholder="https://example.com/path/to/activity.yaml"
              disabled={pending}
            />
          )}
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="code-note">
            Note (optional — shown in the list of codes)
          </label>
          <input
            id="code-note"
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
            <label className={styles.label} htmlFor="code-start">
              Available from (your local time)
            </label>
            <div className={styles.inputRow}>
              <input
                id="code-start"
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
            <label className={styles.label} htmlFor="code-end">
              Available until (your local time)
            </label>
            <div className={styles.inputRow}>
              <input
                id="code-end"
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
            {pending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create code"}
          </button>
          {isEdit && state.status === "saved" ? <span className={styles.saved}>Saved</span> : null}
          {isEdit && code ? (
            <DeleteCodeButton code={code} label={initialNote || code} redirectTo="/codes" />
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
