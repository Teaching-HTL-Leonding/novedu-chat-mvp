"use client";

import { type FormEvent, useState } from "react";
import type { BuildResult } from "@/lib/tutors";
import { CodeBlock } from "../code-block";
import { ErrorList, WarningList } from "./result-views";
import styles from "./validate-tutor.module.css";

type Status = "idle" | "loading" | "done";

// Thin client consumer: it owns no validation logic. It POSTs the URL to
// /api/validate-tutor and renders whatever BuildResult comes back — either the
// assembled system prompt (as markdown) or the structured error list.
export function ValidateTutorForm() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<BuildResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setResult(null);
    setRequestError(null);
    try {
      const res = await fetch("/api/validate-tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      setResult((await res.json()) as BuildResult);
    } catch {
      setRequestError("Could not reach the validation service. Please try again.");
    } finally {
      setStatus("done");
    }
  }

  return (
    <div className={styles.container}>
      <form className={styles.form} onSubmit={onSubmit}>
        <input
          type="url"
          required
          className={styles.input}
          placeholder="https://example.com/path/to/tutor.yaml"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={status === "loading"}
        />
        <button
          type="submit"
          className={styles.button}
          disabled={status === "loading" || url.trim() === ""}
        >
          {status === "loading" ? "Validating…" : "Validate"}
        </button>
      </form>

      <div className={styles.output}>
        {status === "loading" ? <p className={styles.muted}>Validating…</p> : null}
        {requestError ? <p className={styles.requestError}>{requestError}</p> : null}
        {result ? (
          <>
            {result.warnings.length > 0 ? <WarningList warnings={result.warnings} /> : null}
            {result.ok ? (
              // Show the assembled prompt as markdown SOURCE, reusing the chat's
              // CodeBlock so we get syntax coloring, line numbers, and copy for free.
              <CodeBlock className="language-markdown">{result.prompt}</CodeBlock>
            ) : (
              <ErrorList errors={result.errors} />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
