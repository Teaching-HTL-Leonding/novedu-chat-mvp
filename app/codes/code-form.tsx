"use client";

import { type ReactNode, useActionState, useState } from "react";
import { BackLink } from "@/components/back-link";
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

const INITIAL_STATE: CodeFormState = { status: "idle" };

export interface CodeFormProps {
  mode: "create" | "edit";
  /** Create: preselects the activity. Edit: the row's module (shown read-only). */
  initialModule?: CodeModule;
  /** Editable in create mode; shown read-only (never submitted) in edit mode. */
  initialFileUrl?: string;
  initialNote?: string;
  initialStartSeconds?: number;
  initialEndSeconds?: number;
  /** Edit mode only: the code being edited. */
  code?: string;
  /**
   * Edit mode only: the module's result body (server-rendered), shown above the form —
   * tutor/quiz/writing render the share link, coding its little-coder connection config.
   */
  resultSlot?: ReactNode;
}

// One form for BOTH creating and editing a code. Validation + storage live in the
// server actions; this only converts the datetime-local values (local wall-clock)
// to unix seconds — a conversion that MUST happen in the browser, the only place
// the teacher's timezone is known. Create picks the activity (`module`) + file and
// redirects to the new code's edit page on success (which shows the module's result
// body — `resultSlot`). Edit changes the note/window only — the module + file URL are frozen
// (shown read-only), so there is no YAML re-validation.
export function CodeForm({
  mode,
  initialModule = "tutor",
  initialFileUrl = "",
  initialNote = "",
  initialStartSeconds,
  initialEndSeconds,
  code,
  resultSlot,
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

      {isEdit ? resultSlot : null}

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
              Available from (your local time — leave blank for no start)
            </label>
            <div className={styles.inputRow}>
              <input
                id="code-start"
                type="datetime-local"
                name="start"
                className={styles.input}
                value={start}
                onChange={(event) => setStart(event.target.value)}
                disabled={pending}
              />
              <button
                type="button"
                className={styles.quickButton}
                onClick={() => setStart("")}
                disabled={pending || !start}
                title="No start"
                aria-label="Clear start"
              >
                Clear
              </button>
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
              Available until (your local time — leave blank for no end)
            </label>
            <div className={styles.inputRow}>
              <input
                id="code-end"
                type="datetime-local"
                name="end"
                className={styles.input}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                disabled={pending}
              />
              <button
                type="button"
                className={styles.quickButton}
                onClick={() => setEnd("")}
                disabled={pending || !end}
                title="No end"
                aria-label="Clear end"
              >
                Clear
              </button>
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
