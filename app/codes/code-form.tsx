"use client";

import { type ReactNode, useActionState, useState } from "react";
import { BackLink } from "@/components/back-link";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input, Select } from "@/components/ui/input";
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

const INITIAL_STATE: CodeFormState = { status: "idle" };

// Fields inside the window row grow side by side; top-level fields only stretch
// (the form's main axis is vertical, so growing would stretch an input to the
// page height).
const ROW_FIELD_CLASSES = "grow basis-72 self-stretch";
const INPUT_ROW = "flex items-center gap-1.5";
// The tutor URL / activity shown read-only in edit mode (cannot be changed).
const READONLY_INPUT = "bg-foreground/5 font-mono text-foreground/70";

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
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-5">
      <BackLink href="/codes">Back to codes</BackLink>

      {isEdit ? resultSlot : null}

      <form className="flex shrink-0 flex-col items-start gap-3.5" action={formAction}>
        <Field className="self-stretch">
          <FieldLabel htmlFor="code-module">Activity</FieldLabel>
          {isEdit ? (
            <Input
              id="code-module"
              type="text"
              className={READONLY_INPUT}
              readOnly
              value={codeModuleLabels[initialModule].badge}
              aria-label="Activity (read-only)"
              title="The activity cannot be changed — create a new code for a different activity."
            />
          ) : (
            <Select
              id="code-module"
              name="module"
              defaultValue={initialModule}
              className="font-mono"
              disabled={pending}
            >
              {CODE_MODULES.map((m) => (
                <option key={m} value={m}>
                  {codeModuleLabels[m].badge}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field className="self-stretch">
          <FieldLabel htmlFor="code-url">Activity YAML URL</FieldLabel>
          {isEdit ? (
            <Input
              id="code-url"
              type="url"
              className={READONLY_INPUT}
              readOnly
              value={initialFileUrl}
              aria-label="Activity YAML URL (read-only)"
              title="The file URL cannot be changed — create a new code to share a different file."
            />
          ) : (
            <Input
              id="code-url"
              type="url"
              name="file"
              required
              autoComplete="on"
              defaultValue={initialFileUrl}
              className="font-mono"
              placeholder="https://example.com/path/to/activity.yaml"
              disabled={pending}
            />
          )}
        </Field>

        <Field className="self-stretch">
          <FieldLabel htmlFor="code-note">Note (optional — shown in the list of codes)</FieldLabel>
          <Input
            id="code-note"
            type="text"
            name="note"
            maxLength={200}
            autoComplete="on"
            defaultValue={initialNote}
            className="font-mono"
            placeholder="e.g. 3AHIF linked lists exercise"
            disabled={pending}
          />
        </Field>

        <div className="flex flex-wrap gap-3.5 self-stretch">
          <Field className={ROW_FIELD_CLASSES}>
            <FieldLabel htmlFor="code-start">
              Available from (your local time — leave blank for no start)
            </FieldLabel>
            <div className={INPUT_ROW}>
              <Input
                id="code-start"
                type="datetime-local"
                name="start"
                className="min-w-0 flex-1 font-mono"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                disabled={pending}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStart("")}
                disabled={pending || !start}
                title="No start"
                aria-label="Clear start"
              >
                Clear
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStart(nowAsDatetimeLocal())}
                disabled={pending}
              >
                Now
              </Button>
            </div>
          </Field>
          <Field className={ROW_FIELD_CLASSES}>
            <FieldLabel htmlFor="code-end">
              Available until (your local time — leave blank for no end)
            </FieldLabel>
            <div className={INPUT_ROW}>
              <Input
                id="code-end"
                type="datetime-local"
                name="end"
                className="min-w-0 flex-1 font-mono"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                disabled={pending}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEnd("")}
                disabled={pending || !end}
                title="No end"
                aria-label="Clear end"
              >
                Clear
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => extendEnd(1, "hours")}
                disabled={pending}
              >
                +1h
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => extendEnd(1, "days")}
                disabled={pending}
              >
                +1d
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => extendEnd(1, "weeks")}
                disabled={pending}
              >
                +1w
              </Button>
            </div>
          </Field>
        </div>

        {/* What the server stores: the window as unix seconds (UTC). */}
        <input
          type="hidden"
          name="startTs"
          value={start ? datetimeLocalToUnixSeconds(start) : ""}
        />
        <input type="hidden" name="endTs" value={end ? datetimeLocalToUnixSeconds(end) : ""} />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save changes" : "Create code"}
          </Button>
          {isEdit && state.status === "saved" ? (
            <span className="text-sm text-success">Saved</span>
          ) : null}
        </div>
      </form>

      <div className="flex shrink-0 flex-col gap-4">
        {state.status === "error" && "message" in state ? (
          <p className="text-destructive">{state.message}</p>
        ) : null}
        {state.status === "error" && "errors" in state ? <ErrorList errors={state.errors} /> : null}
      </div>
    </div>
  );
}
