"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorList, FragmentSummary, WarningList } from "@/components/validation-result";
import type { BuildResult, FragmentCheckResult } from "@/lib/tutors";
import { CodeBlock } from "../code-block";

type Status = "idle" | "loading" | "done";
type Kind = "tutor" | "fragment";

// The caller declares the kind (no auto-detection), so we keep the kind we
// REQUESTED next to the raw core result. That pairing is all the view needs to
// pick a renderer — the server response carries no discriminator.
type Outcome =
  | { kind: "tutor"; result: BuildResult }
  | { kind: "fragment"; result: FragmentCheckResult };

// Render the validated body by kind. Branching on `kind` first narrows `result`
// cleanly to one concrete result type before we look at `ok`.
function renderBody(outcome: Outcome) {
  if (outcome.kind === "tutor") {
    const { result } = outcome;
    return result.ok ? (
      // The assembled prompt, shown as markdown SOURCE — reuse the chat's
      // CodeBlock for syntax coloring, line numbers, and copy.
      <CodeBlock className="language-markdown">{result.prompt}</CodeBlock>
    ) : (
      <ErrorList errors={result.errors} />
    );
  }
  const { result } = outcome;
  return result.ok ? <FragmentSummary result={result} /> : <ErrorList errors={result.errors} />;
}

// Thin client consumer: it owns no validation logic. It POSTs { url, kind } to
// /api/validate-tutor and renders whatever result comes back — the assembled
// system prompt, the fragment-library summary, or the structured error list.
export function ValidateTutorForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<Kind>("tutor");
  const [status, setStatus] = useState<Status>("idle");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setOutcome(null);
    setRequestError(null);
    try {
      const res = await fetch("/api/validate-tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, kind }),
      });
      const result = (await res.json()) as BuildResult | FragmentCheckResult;
      // We know which kind we asked for, so re-pair it for the view.
      setOutcome(
        kind === "fragment"
          ? { kind, result: result as FragmentCheckResult }
          : { kind, result: result as BuildResult },
      );
    } catch {
      setRequestError("Could not reach the validation service. Please try again.");
    } finally {
      setStatus("done");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-5">
      <div
        className="flex shrink-0 items-center gap-2"
        role="radiogroup"
        aria-label="What to validate"
      >
        {(
          [
            ["tutor", "Tutor"],
            ["fragment", "Fragment library"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="inline-flex cursor-pointer items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="kind"
              value={value}
              checked={kind === value}
              onChange={() => setKind(value)}
              disabled={status === "loading"}
            />
            {label}
          </label>
        ))}
      </div>

      <form className="flex shrink-0 items-center gap-2" onSubmit={onSubmit}>
        <Input
          type="url"
          required
          className="min-w-0 flex-1 font-mono"
          placeholder={
            kind === "fragment"
              ? "https://example.com/path/to/fragments.yaml"
              : "https://example.com/path/to/tutor.yaml"
          }
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={status === "loading"}
        />
        <Button type="submit" disabled={status === "loading" || url.trim() === ""}>
          {status === "loading" ? "Validating…" : "Validate"}
        </Button>
        {/* Opens the read-only student-built GUI for the entered URL. */}
        <Button
          disabled={status === "loading" || url.trim() === ""}
          onClick={() => router.push(`/files/gui/view?url=${encodeURIComponent(url)}&kind=${kind}`)}
        >
          View in GUI
        </Button>
      </form>

      <div className="flex flex-1 flex-col gap-4">
        {status === "loading" ? <p className="text-foreground/60">Validating…</p> : null}
        {requestError ? <p className="text-destructive">{requestError}</p> : null}
        {outcome ? (
          <>
            {outcome.result.warnings.length > 0 ? (
              <WarningList warnings={outcome.result.warnings} />
            ) : null}
            {renderBody(outcome)}
          </>
        ) : null}
      </div>
    </div>
  );
}
