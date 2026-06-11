"use client";

import { CopilotChat, CopilotKitProvider } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";
import { type HTMLAttributes, useState } from "react";
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
// Attachments are capped client-side at 5 MB per image: photos are inlined as
// base64 into the chat request AND replayed from Mastra memory on every
// following turn, so big files would bloat both the request body and the
// model's context.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function TutorChat({
  tutorUrl,
  runtimeHeaders,
  prompt,
  warnings,
  imageInput,
  title,
  description,
}: {
  tutorUrl: string;
  runtimeHeaders: Record<string, string>;
  prompt: string;
  warnings: ValidationWarning[];
  /** Tutor `llm.imageInput`: students may attach images (vision-capable model). */
  imageInput: boolean;
  /** Tutor `title`: replaces the default "How can I help you today?" greeting. */
  title?: string;
  /** Tutor `description`: rendered below the greeting on the welcome screen. */
  description: string;
}) {
  // Compose the built-in welcome heading (which renders `labels.welcomeMessageText`,
  // i.e. the tutor title or the CopilotKit default) and add the description below it.
  const WelcomeWithDescription = (props: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>
      <CopilotChat.View.WelcomeMessage />
      <p className={styles.welcomeDescription}>{description}</p>
    </div>
  );
  // Rejected uploads (too large, wrong type) call onUploadFailed and silently
  // drop the file — without this notice the student would never learn why.
  const [uploadError, setUploadError] = useState<string | null>(null);

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

      {uploadError ? (
        <div className={styles.uploadError} role="alert">
          <span>{uploadError}</span>
          <button
            type="button"
            className={styles.uploadErrorDismiss}
            onClick={() => setUploadError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

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
            labels={title ? { welcomeMessageText: title } : undefined}
            welcomeScreen={description ? { welcomeMessage: WelcomeWithDescription } : undefined}
            messageView={{ assistantMessage: { markdownRenderer: MarkdownRenderer } }}
            attachments={
              imageInput
                ? {
                    enabled: true,
                    accept: "image/*",
                    maxSize: MAX_IMAGE_BYTES,
                    onUploadFailed: ({ file, message }) =>
                      setUploadError(`${file.name}: ${message}`),
                  }
                : undefined
            }
          />
        </CopilotKitProvider>
      </div>
    </>
  );
}
