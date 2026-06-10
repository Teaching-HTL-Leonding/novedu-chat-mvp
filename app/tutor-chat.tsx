"use client";

import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import type { ValidationWarning } from "@/lib/tutors";
import { CodeBlock } from "./code-block";
import { MarkdownRenderer } from "./markdown-renderer";
import styles from "./page.module.css";
import { WarningList } from "./validate-tutor/result-views";

// The chat surface. There is no tutor input here anymore: the server component
// (app/page.tsx) verifies the signed share link and the tutor YAML and passes
// the result down — including the ready-made runtime headers carrying the
// signed parameters, which travel along on every runtime request so the
// backend can re-verify them. The client is never trusted.
//
// The prompt preview is intentionally visible to everyone with a valid link:
// the app is in early preview and the preview is a debugging aid.
export function TutorChat({
  tutorUrl,
  runtimeHeaders,
  prompt,
  warnings,
}: {
  tutorUrl: string;
  runtimeHeaders: Record<string, string>;
  prompt: string;
  warnings: ValidationWarning[];
}) {
  return (
    <>
      <div className={styles.tutorBar}>
        <span className={styles.tutorUrl} title={tutorUrl}>
          {tutorUrl}
        </span>
      </div>

      <details className={styles.details}>
        <summary className={styles.detailsSummary}>System prompt &amp; warnings</summary>
        <div className={styles.detailsBody}>
          {warnings.length > 0 ? <WarningList warnings={warnings} /> : null}
          <CodeBlock className="language-markdown">{prompt}</CodeBlock>
        </div>
      </details>

      <div className={styles.chat}>
        {/*
          The tutor URL must NOT go in runtimeUrl's query string: CopilotKit
          builds sub-route URLs (e.g. /info) by appending to runtimeUrl, which
          would yield `/api/copilotkit?tutor=...yaml/info` (404). Pass it — and
          the share-link signature material — as headers instead, sent on every
          runtime request and verified server-side.
        */}
        <CopilotKitProvider key={tutorUrl} runtimeUrl="/api/copilotkit" headers={runtimeHeaders}>
          <CopilotChat
            agentId="tutor"
            messageView={{ assistantMessage: { markdownRenderer: MarkdownRenderer } }}
          />
        </CopilotKitProvider>
      </div>
    </>
  );
}
