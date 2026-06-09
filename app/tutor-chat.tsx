"use client";

import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { type FormEvent, useState } from "react";
import type { BuildResult } from "@/lib/tutors";
import { CodeBlock } from "./code-block";
import { MarkdownRenderer } from "./markdown-renderer";
import styles from "./page.module.css";
import { ErrorList, WarningList } from "./validate-tutor/result-views";
import formStyles from "./validate-tutor/validate-tutor.module.css";

type Status = "idle" | "loading" | "done";

// The whole chat is configured by a tutor-definition YAML. The user pastes a
// public URL; we validate + assemble it server-side (reusing /api/validate-tutor
// and the lib/tutors core). On success the tutor URL is handed to the backend on
// the runtime URL (`/api/copilotkit?tutor=...`), where the `tutor` agent resolves
// its system prompt + model from it. On failure we show the structured errors.
export function TutorChat() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<BuildResult | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  // The URL that passed validation and is now driving the chat (null = show form).
  const [activeUrl, setActiveUrl] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setResult(null);
    setRequestError(null);
    setActiveUrl(null);
    try {
      const res = await fetch("/api/validate-tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as BuildResult;
      setResult(data);
      if (data.ok) setActiveUrl(url);
    } catch {
      setRequestError("Could not reach the validation service. Please try again.");
    } finally {
      setStatus("done");
    }
  }

  function changeTutor() {
    setActiveUrl(null);
    setResult(null);
  }

  // Active tutor → drive the chat. CopilotKit is scoped here so its runtime URL
  // can carry the tutor URL; `key` remounts the chat (fresh thread) per tutor.
  if (activeUrl && result?.ok) {
    return (
      <>
        <div className={styles.tutorBar}>
          <span className={styles.tutorUrl} title={activeUrl}>
            {activeUrl}
          </span>
          <button type="button" className={styles.changeButton} onClick={changeTutor}>
            Change tutor
          </button>
        </div>

        <details className={styles.details}>
          <summary className={styles.detailsSummary}>System prompt &amp; warnings</summary>
          <div className={styles.detailsBody}>
            {result.warnings.length > 0 ? <WarningList warnings={result.warnings} /> : null}
            <CodeBlock className="language-markdown">{result.prompt}</CodeBlock>
          </div>
        </details>

        <div className={styles.chat}>
          {/*
            The tutor URL must NOT go in runtimeUrl's query string: CopilotKit
            builds sub-route URLs (e.g. /info) by appending to runtimeUrl, which
            would yield `/api/copilotkit?tutor=...yaml/info` (404). Pass it as a
            header instead — sent on every runtime request, read server-side.
          */}
          <CopilotKitProvider
            key={activeUrl}
            runtimeUrl="/api/copilotkit"
            headers={{ "x-tutor-url": activeUrl }}
          >
            <CopilotChat
              agentId="tutor"
              messageView={{ assistantMessage: { markdownRenderer: MarkdownRenderer } }}
            />
          </CopilotKitProvider>
        </div>
      </>
    );
  }

  // Otherwise → the URL form (with errors if the last attempt failed).
  return (
    <div className={formStyles.container}>
      <form className={formStyles.form} onSubmit={onSubmit}>
        <input
          type="url"
          required
          className={formStyles.input}
          placeholder="https://example.com/path/to/tutor.yaml"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          disabled={status === "loading"}
        />
        <button
          type="submit"
          className={formStyles.button}
          disabled={status === "loading" || url.trim() === ""}
        >
          {status === "loading" ? "Loading…" : "Start"}
        </button>
      </form>

      <div className={formStyles.output}>
        {status === "loading" ? <p className={formStyles.muted}>Validating tutor…</p> : null}
        {requestError ? <p className={formStyles.requestError}>{requestError}</p> : null}
        {result && !result.ok ? (
          <>
            {result.warnings.length > 0 ? <WarningList warnings={result.warnings} /> : null}
            <ErrorList errors={result.errors} />
          </>
        ) : null}
      </div>
    </div>
  );
}
