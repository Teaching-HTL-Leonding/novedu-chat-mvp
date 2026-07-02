"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BackLink } from "@/components/back-link";
import { CopyIconButton } from "@/components/copy-icon-button";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ErrorList, WarningList } from "@/components/validation-result";
import {
  updateFileAction,
  type ValidationError,
  type ValidationWarning,
  validateExistingFileAction,
} from "@/lib/yaml-files";
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
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-6">
      <BackLink href="/files">Back to files</BackLink>

      <div className="flex flex-wrap items-baseline gap-5 text-foreground/70 text-sm [&_code]:font-mono [&_code]:text-foreground">
        <span>
          Name: <code>{name}</code>
        </span>
        <span>
          Kind: <code>{kind}</code>
        </span>
      </div>

      <Field>
        <FieldLabel htmlFor="public-file-url">Public URL (use this in a tutor code)</FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id="public-file-url"
            className="min-w-0 flex-1 font-mono"
            readOnly
            value={publicUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
          <CopyIconButton text={publicUrl} label="Copy URL" promptLabel="Copy the file URL:" />
        </div>
      </Field>

      <YamlEditor
        value={content}
        onChange={(value) => {
          setContent(value);
          resetFeedback();
        }}
        disabled={pending}
        fill
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={onValidate} disabled={pending}>
          {validating ? "Validating…" : "Validate"}
        </Button>
        <Button onClick={onSave} disabled={pending}>
          {saving ? "Saving…" : "Validate & save"}
        </Button>
        {message ? <p className="text-destructive text-sm">{message}</p> : null}
        {saved && !message && !errors ? <span className="text-sm text-success">Saved</span> : null}
        {passed && !saved && !message && !errors ? (
          <span className="text-sm text-success">Validation passed</span>
        ) : null}
      </div>

      {errors ? <ErrorList errors={errors} /> : null}
      {passed && warnings && warnings.length > 0 ? <WarningList warnings={warnings} /> : null}
    </div>
  );
}
